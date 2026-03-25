import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";
import { CUSTOM_TOOL_DEFINITIONS, getCustomToolNames, executeCustomTool } from "./services/custom-tools.server";
import appCache, { CacheTTL, toolsListKey } from "./services/cache.server";

/**
 * Client for interacting with Model Context Protocol (MCP) API endpoints.
 * Manages connections to both customer and storefront MCP endpoints, and handles tool invocation.
 */
class MCPClient {
  /**
   * Creates a new MCPClient instance.
   *
   * @param {string} hostUrl - The base URL for the shop
   * @param {string} conversationId - ID for the current conversation
   * @param {string} shopId - ID of the Shopify shop
   */
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.customerTools = [];
    this.storefrontTools = [];
    this.customToolNames = getCustomToolNames();
    // TODO: Make this dynamic, for that first we need to allow access of mcp tools on password proteted demo stores.
    this.storefrontMcpEndpoint = `${hostUrl}/api/mcp`;

    const accountHostUrl = hostUrl.replace(/(\.myshopify\.com)$/, '.account$1');
    this.customerMcpEndpoint = customerMcpEndpoint || `${accountHostUrl}/customer/api/mcp`;
    this.customerAccessToken = "";
    this.conversationId = conversationId;
    this.shopId = shopId;

    // Register custom tools immediately (available before MCP connection)
    this.tools = [...CUSTOM_TOOL_DEFINITIONS];
    console.log(`[MCP-CLIENT] Registered ${CUSTOM_TOOL_DEFINITIONS.length} custom tools: ${this.customToolNames.join(', ')}`);
  }

  /**
   * Connects to the customer MCP server and retrieves available tools.
   * Attempts to use an existing token or will proceed without authentication.
   *
   * @returns {Promise<Array>} Array of available customer tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToCustomerServer() {
    try {
      console.log('\n👤 [MCP-CLIENT] Connecting to Customer Account MCP server');
      console.log('   - Endpoint:', this.customerMcpEndpoint);

      if (this.conversationId) {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
          console.log('🔐 [MCP-CLIENT] Customer access token found in database');
        } else {
          console.log("⚠️ [MCP-CLIENT] No token in database for conversation:", this.conversationId);
        }
      }

      // If we still don't have a token, we'll connect without one
      // and tools that require auth will prompt for it later
      const headers = {
        "Content-Type": "application/json",
        "Authorization": this.customerAccessToken || ""
      };

      // Check cache first
      const cacheKey = toolsListKey(this.customerMcpEndpoint);
      const cachedTools = appCache.get(cacheKey);
      if (cachedTools) {
        console.log('📦 [MCP-CLIENT] Using cached customer tools list');
        this.customerTools = cachedTools;
        this.tools = [...this.tools, ...cachedTools];
        return cachedTools;
      }

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      console.log('✅ [MCP-CLIENT] Customer MCP server response received');

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const customerTools = this._formatToolsData(toolsData);

      console.log('🛠️ [MCP-CLIENT] Customer tools available:', customerTools.length);
      customerTools.forEach((tool, idx) => {
        console.log(`   ${idx + 1}. ${tool.name}: ${tool.description || 'No description'}`);
      });

      this.customerTools = customerTools;
      this.tools = [...this.tools, ...customerTools];

      // Cache for 5 minutes
      appCache.set(cacheKey, customerTools, CacheTTL.TOOLS_LIST);

      console.log('✅ [MCP-CLIENT] Customer connection complete\n');
      return customerTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Connects to the storefront MCP server and retrieves available tools.
   *
   * @returns {Promise<Array>} Array of available storefront tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToStorefrontServer() {
    try {
      console.log('\n🏪 [MCP-CLIENT] Connecting to Storefront MCP server');
      console.log('   - Endpoint:', this.storefrontMcpEndpoint);

      // Check cache first
      const cacheKey = toolsListKey(this.storefrontMcpEndpoint);
      const cachedTools = appCache.get(cacheKey);
      if (cachedTools) {
        console.log('📦 [MCP-CLIENT] Using cached storefront tools list');
        this.storefrontTools = cachedTools;
        this.tools = [...this.tools, ...cachedTools];
        return cachedTools;
      }

      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      console.log('✅ [MCP-CLIENT] Storefront MCP server response received');

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const storefrontTools = this._formatToolsData(toolsData);

      console.log('🛠️ [MCP-CLIENT] Storefront tools available:', storefrontTools.length);
      storefrontTools.forEach((tool, idx) => {
        console.log(`   ${idx + 1}. ${tool.name}: ${tool.description || 'No description'}`);
      });

      this.storefrontTools = storefrontTools;
      this.tools = [...this.tools, ...storefrontTools];

      // Cache for 5 minutes
      appCache.set(cacheKey, storefrontTools, CacheTTL.TOOLS_LIST);

      console.log('✅ [MCP-CLIENT] Storefront connection complete\n');
      return storefrontTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Dispatches a tool call to the appropriate MCP server based on the tool name.
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If tool is not found or call fails
   */
  async callTool(toolName, toolArgs) {
    // Custom tools (local, no MCP)
    if (this.customToolNames.includes(toolName)) {
      console.log(`[MCP-CLIENT] Routing to custom tool: ${toolName}`);
      return executeCustomTool(toolName, toolArgs, this.conversationId);
    }
    // MCP tools
    if (this.customerTools.some(tool => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some(tool => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool ${toolName} not found`);
    }
  }

  /**
   * Calls a tool on the storefront MCP server.
   *
   * @param {string} toolName - Name of the storefront tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If the tool call fails
   */
  async callStorefrontTool(toolName, toolArgs) {
    try {
      console.log('\n🛍️ [MCP-CLIENT] Calling Storefront MCP tool');
      console.log('   - Tool name:', toolName);
      console.log('   - Arguments:', JSON.stringify(toolArgs, null, 2));
      console.log('   - Endpoint:', this.storefrontMcpEndpoint);

      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/call",
        {
          name: toolName,
          arguments: toolArgs,
        },
        headers
      );

      console.log('✅ [MCP-CLIENT] Storefront tool response received');
      console.log('   - Has result:', !!response.result);
      console.log('   - Response type:', typeof response.result);

      return response.result || response;
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Calls a tool on the customer MCP server.
   * Handles authentication if needed.
   *
   * @param {string} toolName - Name of the customer tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call or auth error
   * @throws {Error} If the tool call fails
   */
  async callCustomerTool(toolName, toolArgs) {
    try {
      console.log('\n👤 [MCP-CLIENT] Calling Customer Account MCP tool');
      console.log('   - Tool name:', toolName);
      console.log('   - Arguments:', JSON.stringify(toolArgs, null, 2));
      console.log('   - Endpoint:', this.customerMcpEndpoint);

      // First try to get a token from the database for this conversation
      let accessToken = this.customerAccessToken;

      if (!accessToken || accessToken === "") {
        console.log('🔍 [MCP-CLIENT] No token in memory, checking database...');
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          accessToken = dbToken.accessToken;
          this.customerAccessToken = accessToken; // Store it for later use
          console.log('✅ [MCP-CLIENT] Token found in database');
        } else {
          console.log("⚠️ [MCP-CLIENT] No token in database for conversation:", this.conversationId);
        }
      } else {
        console.log('✅ [MCP-CLIENT] Using existing access token from memory');
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": accessToken
      };

      try {
        const response = await this._makeJsonRpcRequest(
          this.customerMcpEndpoint,
          "tools/call",
          {
            name: toolName,
            arguments: toolArgs,
          },
          headers
        );

        console.log('✅ [MCP-CLIENT] Customer tool response received');
        console.log('   - Has result:', !!response.result);
        console.log('   - Response type:', typeof response.result);

        return response.result || response;
      } catch (error) {
        // Handle 401 specifically to trigger authentication
        if (error.status === 401) {
          console.log("🔐 [MCP-CLIENT] Unauthorized (401), generating authorization URL for customer");

          // Generate auth URL
          const authResponse = await generateAuthUrl(this.conversationId, this.shopId);

          // Instead of retrying, return the auth URL for the front-end
          return {
            error: {
              type: "auth_required",
              data: `You need to authorize the app to access your customer data. [Click here to authorize](${authResponse.url})`
            }
          };
        }

        // Re-throw other errors
        throw error;
      }
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      return {
        error: {
          type: "internal_error",
          data: `Error calling tool ${toolName}: ${error.message}`
        }
      };
    }
  }

  /**
   * Makes a JSON-RPC request to the specified endpoint.
   *
   * @private
   * @param {string} endpoint - The endpoint URL
   * @param {string} method - The JSON-RPC method to call
   * @param {Object} params - Parameters for the method
   * @param {Object} headers - HTTP headers for the request
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} If the request fails
   */
  async _makeJsonRpcRequest(endpoint, method, params, headers, retries = 3) {
    const timeoutMs = 10000; // 10 second timeout

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(endpoint, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: method,
            id: 1,
            params: params
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();
          const errorObj = new Error(`Request failed: ${response.status} ${error}`);
          errorObj.status = response.status;

          // Don't retry 401 (auth) or 400 (bad request) errors
          if (response.status === 401 || response.status === 400) {
            throw errorObj;
          }

          // Retry on 5xx or 429
          if (attempt < retries && (response.status >= 500 || response.status === 429)) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            console.log(`[MCP-CLIENT] Request failed (${response.status}), retrying in ${delay}ms (attempt ${attempt}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          throw errorObj;
        }

        return await response.json();
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn(`[MCP-CLIENT] Request to ${endpoint} timed out (attempt ${attempt}/${retries})`);
          if (attempt < retries) {
            const delay = Math.pow(2, attempt - 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
          timeoutError.status = 408;
          throw timeoutError;
        }
        // Re-throw non-retryable errors immediately
        if (error.status === 401 || error.status === 400) throw error;
        if (attempt === retries) throw error;

        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`[MCP-CLIENT] Request failed, retrying in ${delay}ms (attempt ${attempt}/${retries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Formats raw tool data into a consistent format.
   *
   * @private
   * @param {Array} toolsData - Raw tools data from the API
   * @returns {Array} Formatted tools data
   */
  _formatToolsData(toolsData) {
    return toolsData.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema || tool.input_schema,
      };
    });
  }
}

export default MCPClient;
