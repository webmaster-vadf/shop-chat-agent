/**
 * VADF Support & Chat - Client-side implementation
 * Dual mode: Support menu with FAQ links + AI Chat
 */
(function() {
  'use strict';

  const VADFChat = {
    elements: {},
    isMobile: false,
    conversationId: null,
    currentView: 'menu', // 'menu' or 'chat'

    init: function() {
      const container = document.querySelector('.shop-ai-chat-container');
      if (!container) {
        return;
      }

      // Cache DOM elements
      this.elements = {
        container: container,
        chatBubble: container.querySelector('.shop-ai-chat-bubble'),
        chatWindow: container.querySelector('.shop-ai-chat-window'),
        closeButton: container.querySelector('.shop-ai-chat-close'),
        supportMenu: document.getElementById('supportMenu'),
        chatView: document.getElementById('chatView'),
        openChatBtn: document.getElementById('openChatBtn'),
        backToMenuBtn: document.getElementById('backToMenuBtn'),
        messagesContainer: container.querySelector('.shop-ai-chat-messages'),
        chatInput: container.querySelector('.shop-ai-chat-input input'),
        sendButton: container.querySelector('.shop-ai-chat-send')
      };

      // Detect mobile device
      this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      // Set up event listeners
      this.setupEventListeners();

      // Fix for iOS Safari viewport height issues
      if (this.isMobile) {
        this.setupMobileViewport();
      }

      // Generate unique conversation ID
      this.conversationId = this.generateConversationId();
    },

    setupEventListeners: function() {
      const {
        chatBubble, closeButton, openChatBtn, backToMenuBtn,
        chatInput, sendButton
      } = this.elements;

      // Toggle modal when clicking bubble
      if (chatBubble) {
        chatBubble.addEventListener('click', () => {
          this.openModal();
        });
      }

      // Close modal when clicking close button
      if (closeButton) {
        closeButton.addEventListener('click', () => {
          this.closeModal();
        });
      }

      // Open chat view from menu
      if (openChatBtn) {
        openChatBtn.addEventListener('click', () => {
          this.switchToChat();
        });
      }

      // Back to menu from chat
      if (backToMenuBtn) {
        backToMenuBtn.addEventListener('click', () => {
          this.switchToMenu();
        });
      }

      // Send message when pressing Enter
      if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && chatInput.value.trim() !== '') {
            this.sendMessage();
            if (this.isMobile) {
              chatInput.blur();
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });
      }

      // Send message when clicking send button
      if (sendButton) {
        sendButton.addEventListener('click', () => {
          if (chatInput.value.trim() !== '') {
            this.sendMessage();
            if (this.isMobile) {
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });
      }

      // Handle auth links
      document.addEventListener('click', (event) => {
        if (event.target && event.target.classList.contains('shop-auth-trigger')) {
          event.preventDefault();
          if (window.shopAuthUrl) {
            this.openAuthPopup(window.shopAuthUrl);
          }
        }
      });
    },

    setupMobileViewport: function() {
      const setViewportHeight = () => {
        document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
      };
      window.addEventListener('resize', setViewportHeight);
      setViewportHeight();
    },

    generateConversationId: function() {
      return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    openModal: function() {
      const { chatWindow } = this.elements;
      if (!chatWindow) {
        return;
      }

      chatWindow.classList.add('active');
      this.switchToMenu(); // Always show menu first

      if (this.isMobile) {
        document.body.classList.add('shop-ai-chat-open');
      }
    },

    closeModal: function() {
      const { chatWindow } = this.elements;
      if (!chatWindow) return;

      chatWindow.classList.remove('active');
      if (this.isMobile) {
        document.body.classList.remove('shop-ai-chat-open');
      }
    },

    switchToChat: function() {
      const { supportMenu, chatView, chatInput, messagesContainer } = this.elements;

      supportMenu.style.display = 'none';
      chatView.style.display = 'flex';
      this.currentView = 'chat';

      // Focus input
      setTimeout(() => {
        if (chatInput) chatInput.focus();
      }, 300);

      // Show welcome message if first time
      if (!messagesContainer || messagesContainer.children.length === 0) {
        this.addWelcomeMessage();
      }
    },

    switchToMenu: function() {
      const { supportMenu, chatView } = this.elements;

      chatView.style.display = 'none';
      supportMenu.style.display = 'flex';
      this.currentView = 'menu';
    },

    addWelcomeMessage: function() {
      const welcomeMsg = window.shopChatConfig?.welcomeMessage ||
                        "Voici les sujets sur lesquels je peux vous orienter:\n• Créer un compte professionnel\n• Activer votre compte professionnel\n• Réinitialiser votre mot de passe\n• Mettre à jour les informations de votre entreprise\n• Découvrir nos produits et leurs caractéristiques\n• Commander des produits en stock\n• Demander des produits en reliquat";
      this.addMessageToUI('assistant', welcomeMsg);
    },

    sendMessage: function() {
      const { chatInput, messagesContainer } = this.elements;
      const message = chatInput.value.trim();

      if (!message) {
        return;
      }

      // Add user message to UI
      this.addMessageToUI('user', message);
      chatInput.value = '';

      // Show typing indicator
      this.showTypingIndicator();

      // Send to API
      this.sendToAPI(message);
    },

    addMessageToUI: function(role, content) {
      const { messagesContainer } = this.elements;
      if (!messagesContainer) return;

      const messageDiv = document.createElement('div');
      messageDiv.classList.add('shop-ai-message', role);

      if (typeof content === 'string') {
        messageDiv.innerHTML = this.formatMessageContent(content);
      } else {
        messageDiv.textContent = JSON.stringify(content);
      }

      messagesContainer.appendChild(messageDiv);
      this.scrollToBottom();
    },

    formatMessageContent: function(content) {
      // Convert markdown-style formatting to HTML
      let formatted = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      return formatted;
    },

    showTypingIndicator: function() {
      const { messagesContainer } = this.elements;
      if (!messagesContainer) return;

      const typingIndicator = document.createElement('div');
      typingIndicator.classList.add('shop-ai-typing-indicator');
      typingIndicator.innerHTML = '<span></span><span></span><span></span>';
      messagesContainer.appendChild(typingIndicator);
      this.scrollToBottom();
    },

    removeTypingIndicator: function() {
      const { messagesContainer } = this.elements;
      if (!messagesContainer) return;

      const typingIndicator = messagesContainer.querySelector('.shop-ai-typing-indicator');
      if (typingIndicator) {
        typingIndicator.remove();
      } 
    },

    scrollToBottom: function() {
      const { messagesContainer } = this.elements;
      if (!messagesContainer) return;

      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 100);
    },

    sendToAPI: async function(message) {
      const config = window.shopChatConfig || {};

      // Auto-detect local vs production environment
      const isLocal = window.location.hostname.includes('localhost') ||
                      window.location.hostname.includes('127.0.0.1') ||
                      window.location.port !== '';

      const defaultApiUrl = isLocal
        ? 'http://localhost:3000'  // Local dev server
        : 'https://shop-chat-agent-bold-flower-713.fly.dev';  // Production

      const apiBaseUrl = config.apiBaseUrl || defaultApiUrl;
      const shopDomain = window.Shopify?.shop || window.location.hostname;
      const shopId = window.shopId;

      try {
        const response = await fetch(`${apiBaseUrl}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Origin': window.location.origin,
            'X-Shopify-Shop-Domain': shopDomain,
            'X-Shopify-Shop-Id': shopId
          },
          body: JSON.stringify({
            message: message,
            conversation_id: this.conversationId,
            prompt_type: config.promptType || 'vadfAssistant'
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }


        // Handle Server-Sent Events stream
        // Note: typing indicator will be removed when end_turn event arrives
        await this.handleStreamResponse(response);

      } catch (error) {
        this.removeTypingIndicator();
        this.addMessageToUI('assistant', "Désolé, une erreur s'est produite. Veuillez réessayer.");
      }
    },

    handleStreamResponse: async function(response) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentMessage = '';
      let eventCount = 0;


      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                if (currentMessage) {
                  this.addMessageToUI('assistant', currentMessage);
                  currentMessage = '';
                }
                continue;
              }

              try {
                const event = JSON.parse(data);
                eventCount++;

                if (event.type === 'id') {
                } else if (event.type === 'chunk') {
                  currentMessage += event.chunk || '';
                } else if (event.type === 'content_block_delta') {
                  currentMessage += event.delta?.text || '';
                } else if (event.type === 'message_stop' || event.type === 'message_complete') {
                  if (currentMessage) {
                    this.addMessageToUI('assistant', currentMessage);
                    currentMessage = '';
                  }
                } else if (event.type === 'vadf_response') {

                  if (event.text) {
                    this.addMessageToUI('assistant', event.text);
                  }
                } else if (event.type === 'product_results' && event.products) {
                  this.displayProductResults(event.products);
                } else if (event.type === 'auth_required' && event.auth_url) {
                  window.shopAuthUrl = event.auth_url;
                  this.addMessageToUI('assistant', event.message);
                } else if (event.type === 'tool_use') {
                  this.addToolUseToUI(event);
                } else if (event.type === 'end_turn') {
                  this.removeTypingIndicator();
                } 
              } catch (e) {}
            }
          }
        }

        // Final message if any
        if (currentMessage) {
          this.addMessageToUI('assistant', currentMessage);
        }

      } catch (error) {
        this.addMessageToUI('assistant', "Erreur lors de la réception de la réponse.");
      }
    },

    displayProductResults: function(products) {
      const { messagesContainer } = this.elements;
      if (!messagesContainer || !products || products.length === 0) return;

      const productSection = document.createElement('div');
      productSection.classList.add('shop-ai-product-section');

      const header = document.createElement('div');
      header.classList.add('shop-ai-product-header');
      header.innerHTML = '<h4>Produits trouvés</h4>';
      productSection.appendChild(header);

      const grid = document.createElement('div');
      grid.classList.add('shop-ai-product-grid');

      products.forEach(product => {
        const card = this.createProductCard(product);
        grid.appendChild(card);
      });

      productSection.appendChild(grid);
      messagesContainer.appendChild(productSection);
      this.scrollToBottom();
    },

    createProductCard: function(product) {
      const card = document.createElement('a');
      card.href = product.url || '#';
      card.classList.add('shop-ai-product-card');
      card.target = '_blank';
      card.rel = 'noopener';

      const imageDiv = document.createElement('div');
      imageDiv.classList.add('shop-ai-product-image');
      if (product.image) {
        const img = document.createElement('img');
        img.src = product.image;
        img.alt = product.title || 'Product';
        img.loading = 'lazy';
        imageDiv.appendChild(img);
      }

      const infoDiv = document.createElement('div');
      infoDiv.classList.add('shop-ai-product-info');

      const title = document.createElement('h5');
      title.classList.add('shop-ai-product-title');
      title.textContent = product.title || 'Produit';

      const price = document.createElement('p');
      price.classList.add('shop-ai-product-price');
      price.textContent = product.price || '';

      infoDiv.appendChild(title);
      infoDiv.appendChild(price);

      card.appendChild(imageDiv);
      card.appendChild(infoDiv);

      return card;
    },

    openAuthPopup: function(authUrl) {
      const width = 500;
      const height = 600;
      const left = (screen.width / 2) - (width / 2);
      const top = (screen.height / 2) - (height / 2);

      window.open(
        authUrl,
        'auth_popup',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VADFChat.init());
  } else {
    VADFChat.init();
  }

})();
