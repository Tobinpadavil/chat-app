// Connect to Socket.IO server
const socket = io();

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginPage = document.getElementById('loginPage');
    const chatPage = document.getElementById('chatPage');
    const userCode = document.getElementById('userCode');
    const username = document.getElementById('username');
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const loginMessage = document.getElementById('loginMessage');
    const currentUserDisplay = document.getElementById('currentUserDisplay');
    const currentCodeDisplay = document.getElementById('currentCodeDisplay');
    const contactList = document.getElementById('contactList');
    const addContactBtn = document.getElementById('addContactBtn');
    const addContactModal = document.getElementById('addContactModal');
    const contactCode = document.getElementById('contactCode');
    const confirmAddContact = document.getElementById('confirmAddContact');
    const cancelAddContact = document.getElementById('cancelAddContact');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const messageArea = document.getElementById('messageArea');
    const currentChatName = document.getElementById('currentChatName');
    const authTitle = document.getElementById('authTitle');
    const authButtonText = document.getElementById('authButtonText');
    const authToggleText = document.getElementById('authToggleText');
    const toggleAuthButton = document.getElementById('toggleAuthButton');
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    const deleteAccountModal = document.getElementById('deleteAccountModal');
    const confirmDeleteAccount = document.getElementById('confirmDeleteAccount');
    const cancelDeleteAccount = document.getElementById('cancelDeleteAccount');
    const messageContextMenu = document.getElementById('messageContextMenu');

    // State
    let currentUser = {
        code: '',
        username: ''
    };
    let contacts = new Map(); // code -> {username, element}
    let selectedContact = null;
    let isLoginMode = true;

    // Check for saved login
    const savedUser = localStorage.getItem('chatUser');
    if (savedUser) {
        const user = JSON.parse(savedUser);
        userCode.value = user.code;
        username.value = user.username;
        handleLogin();
    }

    // Login Handler
    async function handleLogin() {
        const code = userCode.value.trim();
        const name = username.value.trim();

        if (code.length !== 5 || !/^\d+$/.test(code)) {
            showLoginMessage('Please enter a valid 5-digit code', true);
            return;
        }

        if (!name || name.length < 3) {
            showLoginMessage('Username must be at least 3 characters', true);
            return;
        }

        try {
            const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code, username: name })
            });

            const data = await response.json();
            
            if (data.success) {
                showLoginMessage(data.message, false);
                
                if (!isLoginMode) {
                    // If registration successful, switch to login mode
                    setTimeout(() => {
                        isLoginMode = true;
                        updateAuthUI();
                    }, 1500);
                    return;
                }

                currentUser.code = code;
                currentUser.username = name;
                
                // Save to localStorage
                localStorage.setItem('chatUser', JSON.stringify({ code, username: name }));
                
                // Update UI
                currentUserDisplay.textContent = name;
                currentCodeDisplay.textContent = `#${code}`;
                
                // Connect to socket
                socket.emit('login', { code, username: name });
                
                // Switch to chat
                setTimeout(() => {
                    loginPage.style.display = 'none';
                    chatPage.style.display = 'flex';
                }, 1000);
            } else {
                showLoginMessage(data.message, true);
            }
        } catch (error) {
            console.error('Auth error:', error);
            showLoginMessage('Error connecting to server. Please try again.', true);
        }
    }

    // Logout Handler
    function handleLogout() {
        localStorage.removeItem('chatUser');
        socket.disconnect();
        contacts.clear();
        contactList.innerHTML = '';
        messageArea.innerHTML = '';
        currentUser = { code: '', username: '' };
        selectedContact = null;
        userCode.value = '';
        username.value = '';
        chatPage.style.display = 'none';
        loginPage.style.display = 'flex';
    }

    function showLoginMessage(message, isError) {
        loginMessage.textContent = message;
        loginMessage.className = 'login-message ' + (isError ? 'error' : 'success');
    }

    // Event Listeners
    loginButton.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogin();
    });

    logoutButton.addEventListener('click', handleLogout);

    // Handle Enter key on login inputs
    userCode.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && userCode.value.length === 5) {
            username.focus();
        }
    });

    username.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });

    // Socket event handlers
    socket.on('loginSuccess', () => {
        // Already handled in handleLogin
    });

    socket.on('newMessage', (data) => {
        console.log('Received message:', data);
        const { from, fromUsername, message } = data;
        
        // Add message to chat if the sender's chat is open
        if (selectedContact && selectedContact.code === from) {
            addMessage(message, false, fromUsername);
        } else {
            // Highlight contact with unread message
            const contact = contacts.get(from);
            if (contact && contact.element) {
                contact.element.style.backgroundColor = '#2a3942';
                showNotification(`New message from ${fromUsername}`);
            }
        }

        // Store message in contact's chat history
        const contact = contacts.get(from);
        if (contact) {
            if (!contact.chatHistory) {
                contact.chatHistory = [];
            }
            contact.chatHistory.push(data);
        }
    });

    socket.on('messageSent', (data) => {
        console.log('Message sent confirmation:', data);
        const { message } = data;
        
        if (selectedContact) {
            // Add the sent message to our chat window
            addMessage(message, true);

            // Store message in contact's chat history
            const contact = contacts.get(selectedContact.code);
            if (contact) {
                if (!contact.chatHistory) {
                    contact.chatHistory = [];
                }
                contact.chatHistory.push(data);
            }
        }
    });

    socket.on('error', (data) => {
        showNotification(data.message, true);
    });

    socket.on('contactAdded', (contact) => {
        if (!contacts.has(contact.code)) {
            addContactToList(contact);
            showNotification(`${contact.username} added you as a contact!`);
            
            // If chat history exists, store it
            if (contact.chatHistory) {
                contacts.get(contact.code).chatHistory = contact.chatHistory;
            }
        }
    });

    function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = 'notification' + (isError ? ' error' : '');
        notification.textContent = message;
        document.body.appendChild(notification);

        // Remove notification after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Contact Management
    addContactBtn.addEventListener('click', () => {
        addContactModal.classList.add('active');
        contactCode.value = '';
    });

    cancelAddContact.addEventListener('click', () => {
        addContactModal.classList.remove('active');
    });

    confirmAddContact.addEventListener('click', () => {
        const code = contactCode.value.trim();
        
        if (code.length !== 5 || !/^\d+$/.test(code)) {
            alert('Please enter a valid 5-digit code');
            return;
        }

        if (code === currentUser.code) {
            alert('You cannot add yourself as a contact');
            return;
        }

        if (contacts.has(code)) {
            alert('This contact is already in your list');
            return;
        }

        // Verify contact exists
        socket.emit('verifyContact', code, (response) => {
            if (response.exists) {
                const newContact = {
                    code: code,
                    username: response.username
                };
                addContactToList(newContact);
                addContactModal.classList.remove('active');
                showNotification(`${newContact.username} has been added to your contacts!`);
            } else {
                alert('No user found with this code');
            }
        });
    });

    function addContactToList(contact) {
        const contactElement = document.createElement('div');
        contactElement.classList.add('contact-item');
        contactElement.innerHTML = `
            <div class="contact-info">
                <div class="user-name">${contact.username}</div>
                <div class="user-code">#${contact.code}</div>
            </div>
            <button class="delete-contact-btn">
                <i class="fas fa-user-minus"></i>
            </button>
        `;

        // Add click handler for the contact item
        const contactInfo = contactElement.querySelector('.contact-info');
        contactInfo.addEventListener('click', () => {
            // Remove active class from all contacts
            document.querySelectorAll('.contact-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Add active class to selected contact
            contactElement.classList.add('active');
            contactElement.style.backgroundColor = ''; // Remove unread highlight
            
            // Update selected contact and chat header
            selectedContact = contact;
            currentChatName.textContent = contact.username;
            
            // Clear message area
            messageArea.innerHTML = '';
            
            // Load chat history if available
            const contactData = contacts.get(contact.code);
            if (contactData && contactData.chatHistory) {
                contactData.chatHistory.forEach(msg => {
                    const isSent = msg.from === currentUser.code;
                    addMessage(msg.message, isSent, isSent ? null : contact.username, msg.timestamp);
                });
            } else {
                // Add welcome message
                addMessage(`Start of your conversation with ${contact.username}`, false);
            }
        });

        // Add click handler for delete button
        const deleteBtn = contactElement.querySelector('.delete-contact-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent contact selection when clicking delete
            if (confirm(`Are you sure you want to remove ${contact.username} from your contacts?`)) {
                socket.emit('removeContact', { contactCode: contact.code });
            }
        });

        contacts.set(contact.code, { 
            ...contact, 
            element: contactElement,
            chatHistory: contact.chatHistory || []
        });
        contactList.appendChild(contactElement);
    }

    // Chat Functionality
    function addMessage(text, isSent = true, username = '', timestamp = new Date().toISOString()) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        messageDiv.classList.add(isSent ? 'sent' : 'received');
        messageDiv.dataset.timestamp = timestamp;
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        if (!isSent && username) {
            const senderName = document.createElement('div');
            senderName.className = 'message-sender';
            senderName.textContent = username;
            messageContent.appendChild(senderName);
        }
        
        const messageText = document.createElement('p');
        messageText.textContent = text;
        messageContent.appendChild(messageText);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-time';
        timestampDiv.textContent = new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        messageContent.appendChild(timestampDiv);
        
        messageDiv.appendChild(messageContent);
        messageArea.appendChild(messageDiv);
        
        // Add context menu for message deletion
        messageDiv.addEventListener('contextmenu', (e) => showContextMenu(e, messageDiv));
        
        // Scroll to bottom
        messageArea.scrollTop = messageArea.scrollHeight;
    }

    function sendMessage() {
        if (!selectedContact) {
            alert('Please select a contact first');
            return;
        }

        const message = messageInput.value.trim();
        if (message) {
            console.log('Sending message to:', selectedContact.code);
            // Send message to server
            socket.emit('chatMessage', {
                to: selectedContact.code,
                message: message
            });
            
            // Clear input immediately
            messageInput.value = '';
            // Focus back on input for next message
            messageInput.focus();
        }
    }

    // Send message handlers
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Input validation for 5-digit code
    userCode.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
        if (e.target.value.length === 5) {
            username.focus();
        }
    });

    contactCode.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
    });

    // Add toggle handler
    toggleAuthButton.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        updateAuthUI();
    });

    function updateAuthUI() {
        authTitle.textContent = isLoginMode ? 'Welcome Back' : 'Create Account';
        authButtonText.textContent = isLoginMode ? 'Login' : 'Register';
        authToggleText.textContent = isLoginMode ? "Don't have an account?" : 'Already have an account?';
        toggleAuthButton.textContent = isLoginMode ? 'Register' : 'Login';
        loginMessage.textContent = '';
    }

    // Delete Account functionality
    deleteAccountBtn.addEventListener('click', () => {
        deleteAccountModal.classList.add('active');
    });

    cancelDeleteAccount.addEventListener('click', () => {
        deleteAccountModal.classList.remove('active');
    });

    confirmDeleteAccount.addEventListener('click', () => {
        socket.emit('deleteAccount');
    });

    socket.on('accountDeleted', () => {
        localStorage.removeItem('chatUser');
        window.location.reload();
    });

    socket.on('contactDeleted', (data) => {
        const { code } = data;
        const contact = contacts.get(code);
        if (contact && contact.element) {
            contact.element.remove();
        }
        contacts.delete(code);
        
        if (selectedContact && selectedContact.code === code) {
            selectedContact = null;
            messageArea.innerHTML = '';
            currentChatName.textContent = '';
        }
        
        showNotification('Contact has deleted their account');
    });

    // Message deletion functionality
    let selectedMessage = null;

    function showContextMenu(e, message) {
        e.preventDefault();
        selectedMessage = message;
        messageContextMenu.style.display = 'block';
        messageContextMenu.style.left = `${e.pageX}px`;
        messageContextMenu.style.top = `${e.pageY}px`;
    }

    // Hide context menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!messageContextMenu.contains(e.target)) {
            messageContextMenu.style.display = 'none';
        }
    });

    // Handle message deletion
    document.querySelector('.delete-message').addEventListener('click', () => {
        if (selectedMessage && selectedContact) {
            socket.emit('deleteMessage', {
                messageId: selectedMessage.dataset.timestamp,
                chatWith: selectedContact.code
            });
            messageContextMenu.style.display = 'none';
        }
    });

    socket.on('messageDeleted', (data) => {
        const { messageId, chatWith } = data;
        
        // Only update UI if the relevant chat is open
        if (selectedContact && (selectedContact.code === chatWith)) {
            const messageElement = document.querySelector(`[data-timestamp="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
        }

        // Update chat history
        const contact = contacts.get(chatWith);
        if (contact && contact.chatHistory) {
            contact.chatHistory = contact.chatHistory.filter(msg => msg.timestamp !== messageId);
        }
    });

    // Contact removal handlers
    socket.on('contactRemoved', (data) => {
        const { code } = data;
        const contact = contacts.get(code);
        if (contact && contact.element) {
            contact.element.remove();
        }
        contacts.delete(code);
        
        if (selectedContact && selectedContact.code === code) {
            selectedContact = null;
            messageArea.innerHTML = '';
            currentChatName.textContent = 'Select a contact';
        }
        
        showNotification('Contact removed successfully');
    });

    socket.on('contactRemovedYou', (data) => {
        const { code, username } = data;
        const contact = contacts.get(code);
        if (contact && contact.element) {
            contact.element.remove();
        }
        contacts.delete(code);
        
        if (selectedContact && selectedContact.code === code) {
            selectedContact = null;
            messageArea.innerHTML = '';
            currentChatName.textContent = 'Select a contact';
        }
        
        showNotification(`${username} has removed you from their contacts`);
    });
});
