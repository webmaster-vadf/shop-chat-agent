/**
 * Streaming Service
 * Provides utilities for handling server-sent events (SSE) streams
 */

/**
 * Creates a StreamManager to handle SSE streams with proper backpressure
 * @param {TextEncoder} encoder - A TextEncoder instance
 * @param {ReadableStreamDefaultController} controller - The stream controller
 * @returns {Object} StreamManager with utility methods for handling streaming
 */
export function createStreamManager(encoder, controller) {
  /**
   * Send a data message to the client
   * @param {Object} data - Data to send
   */
  const sendMessage = (data) => {
    try {
      // Log SSE event being sent (with truncation for large payloads)
      const logData = { ...data };
      if (logData.chunk && logData.chunk.length > 100) {
        logData.chunk = logData.chunk.substring(0, 100) + '...';
      }
      if (logData.text && logData.text.length > 200) {
        logData.textPreview = logData.text.substring(0, 200) + '...';
        delete logData.text;
      }
      if (process.env.DEBUG === 'true') console.log('📡 [SSE] Sending event:', JSON.stringify(logData));

      const text = `data: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(text));
    } catch (error) {
      console.error('Error sending stream message:', error);
    }
  };

  /**
   * Send an error message to the client
   * @param {Object} error - Error object
   * @param {string} error.type - Error type
   * @param {string} error.error - Error title/message
   * @param {string} error.details - Error details
   */
  const sendError = ({ type, error, details }) => {
    sendMessage({ type, error, details });
  };

  /**
   * Close the stream
   */
  const closeStream = () => {
    try {
      controller.close();
    } catch (error) {
      console.error('Error closing stream:', error);
    }
  };

  /**
   * Handle streaming errors by sending appropriate error messages
   * @param {Error} error - The error that occurred
   */
  const handleStreamingError = (error) => {
    console.error('Error processing streaming request:', error);

    if (error.status === 401 || error.message?.includes('auth') || error.message?.includes('key')) {
      sendError({
        type: 'error',
        error: 'Authentication failed with Claude API',
        details: 'Please check your API key in environment variables'
      });
    } else if (error.status === 429 || error.status === 529 || error.message?.includes('Overloaded')) {
      sendError({
        type: 'rate_limit_exceeded',
        error: 'Le service est temporairement surchargé',
        details: 'Veuillez réessayer dans quelques instants.'
      });
    } else if (error.status === 408 || error.message?.includes('timeout') || error.message?.includes('timed out')) {
      sendError({
        type: 'error',
        error: 'Le service a mis trop de temps à répondre',
        details: 'Veuillez reformuler votre question ou réessayer.'
      });
    } else if (error.message?.includes('MCP') || error.message?.includes('mcp')) {
      sendError({
        type: 'error',
        error: 'Service de données temporairement indisponible',
        details: 'Je peux quand même répondre à vos questions générales. Réessayez dans un instant pour les recherches produit.'
      });
    } else {
      sendError({
        type: 'error',
        error: 'Une erreur est survenue',
        details: error.message || 'Veuillez réessayer ou contacter support@vadf.fr'
      });
    }
  };

  return {
    sendMessage,
    sendError,
    closeStream,
    handleStreamingError
  };
}

/**
 * Creates a ReadableStream for SSE
 * @param {Function} streamHandler - Async function that handles the stream
 * @returns {ReadableStream} A readable stream for SSE
 */
export function createSseStream(streamHandler) {
  const encoder = new TextEncoder();
  
  return new ReadableStream({
    async start(controller) {
      const streamManager = createStreamManager(encoder, controller);
      
      try {
        await streamHandler(streamManager);
      } catch (error) {
        streamManager.handleStreamingError(error);
      } finally {
        streamManager.closeStream();
      }
    }
  });
}

export default {
  createSseStream,
  createStreamManager
};