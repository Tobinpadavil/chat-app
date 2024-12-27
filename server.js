const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// Middleware
app.use(cors());
app.use(express.static('./'));
app.use(express.json());

// Load users data
let userData = { users: {}, contacts: {}, messages: {} };
const USER_FILE = path.join(__dirname, 'users.json');

try {
    if (fs.existsSync(USER_FILE)) {
        userData = JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
    }
    fs.writeFileSync(USER_FILE, JSON.stringify(userData, null, 4));
} catch (err) {
    console.error('Error loading user data:', err);
    userData = { users: {}, contacts: {}, messages: {} };
    fs.writeFileSync(USER_FILE, JSON.stringify(userData, null, 4));
}

// Save user data
function saveUserData() {
    try {
        fs.writeFileSync(USER_FILE, JSON.stringify(userData, null, 4));
    } catch (err) {
        console.error('Error saving user data:', err);
    }
}

// Store online users
const onlineUsers = new Map(); // code -> {username, socketId}

// Registration endpoint
app.post('/auth/register', (req, res) => {
    try {
        const { code, username } = req.body;
        
        if (!code || !username) {
            return res.status(400).json({
                success: false,
                message: 'Code and username are required'
            });
        }

        if (userData.users[code]) {
            return res.status(400).json({ 
                success: false, 
                message: 'This code is already taken. Please choose another one.' 
            });
        }

        userData.users[code] = { username };
        userData.contacts[code] = [];
        saveUserData();
        
        res.json({ 
            success: true, 
            message: 'Registration successful! You can now login.' 
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
});

// Login endpoint
app.post('/auth/login', (req, res) => {
    try {
        const { code, username } = req.body;

        if (!code || !username) {
            return res.status(400).json({
                success: false,
                message: 'Code and username are required'
            });
        }

        if (!userData.users[code]) {
            return res.status(404).json({ 
                success: false, 
                message: 'No account found with this code' 
            });
        }

        if (userData.users[code].username !== username) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid username for this code' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Login successful' 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
});

// Add this function to handle message storage
function saveMessage(fromCode, toCode, message) {
    // Initialize message arrays if they don't exist
    if (!userData.messages[fromCode]) {
        userData.messages[fromCode] = {};
    }
    if (!userData.messages[fromCode][toCode]) {
        userData.messages[fromCode][toCode] = [];
    }

    // Create message object
    const messageObj = {
        from: fromCode,
        message: message,
        timestamp: new Date().toISOString()
    };

    // Save message in both users' history
    userData.messages[fromCode][toCode].push(messageObj);
    
    // Initialize recipient's message array if needed
    if (!userData.messages[toCode]) {
        userData.messages[toCode] = {};
    }
    if (!userData.messages[toCode][fromCode]) {
        userData.messages[toCode][fromCode] = [];
    }
    userData.messages[toCode][fromCode].push(messageObj);

    // Save to file
    saveUserData();
    
    return messageObj;
}

// Add this function to get chat history
function getChatHistory(userCode, contactCode) {
    if (!userData.messages[userCode] || !userData.messages[userCode][contactCode]) {
        return [];
    }
    return userData.messages[userCode][contactCode];
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected');

    // Handle user login
    socket.on('login', (userInfo) => {
        const { code, username } = userInfo;
        onlineUsers.set(code, { username, socketId: socket.id });
        socket.userCode = code;

        try {
            // Initialize contacts array if it doesn't exist
            if (!userData.contacts[code]) {
                userData.contacts[code] = [];
                saveUserData();
            }

            // Load existing contacts
            const existingContacts = userData.contacts[code];
            if (Array.isArray(existingContacts)) {
                existingContacts.forEach(contactCode => {
                    const contact = userData.users[contactCode];
                    if (contact) {
                        socket.emit('contactAdded', {
                            code: contactCode,
                            username: contact.username,
                            chatHistory: getChatHistory(code, contactCode)
                        });
                    }
                });
            }
            
            socket.emit('loginSuccess');
        } catch (error) {
            console.error('Error in login socket handler:', error);
            socket.emit('error', { message: 'Error loading user data' });
        }
    });

    // Handle contact verification and addition
    socket.on('verifyContact', (contactCode, callback) => {
        try {
            // Validate inputs
            if (!socket.userCode || !contactCode) {
                callback({
                    exists: false,
                    error: 'Invalid request'
                });
                return;
            }

            const contact = userData.users[contactCode];
            const currentUser = userData.users[socket.userCode];

            if (!contact || !currentUser) {
                callback({
                    exists: false,
                    error: 'User not found'
                });
                return;
            }

            // Initialize contact arrays if needed
            if (!userData.contacts[socket.userCode]) {
                userData.contacts[socket.userCode] = [];
            }
            if (!userData.contacts[contactCode]) {
                userData.contacts[contactCode] = [];
            }

            // Check if already contacts
            if (userData.contacts[socket.userCode].includes(contactCode)) {
                callback({
                    exists: true,
                    username: contact.username,
                    error: 'Already in contacts'
                });
                return;
            }

            // Add to both users' contact lists
            userData.contacts[socket.userCode].push(contactCode);
            userData.contacts[contactCode].push(socket.userCode);
            
            // Save changes
            saveUserData();

            // Notify the added contact if they're online
            const onlineContact = onlineUsers.get(contactCode);
            if (onlineContact) {
                io.to(onlineContact.socketId).emit('contactAdded', {
                    code: socket.userCode,
                    username: currentUser.username
                });
            }

            // Send success response
            callback({
                exists: true,
                username: contact.username
            });

            // Send contact info to current user
            socket.emit('contactAdded', {
                code: contactCode,
                username: contact.username
            });

        } catch (error) {
            console.error('Error in verifyContact:', error);
            callback({
                exists: false,
                error: 'Server error during contact verification'
            });
        }
    });

    // Handle chat message
    socket.on('chatMessage', (data) => {
        try {
            console.log('Received chat message:', data);
            const { to, message } = data;
            
            // Validate the message
            if (!message || !to || !socket.userCode) {
                console.log('Invalid message data');
                socket.emit('error', { message: 'Invalid message data' });
                return;
            }

            // Get sender info
            const sender = userData.users[socket.userCode];
            if (!sender) {
                console.log('Sender not found:', socket.userCode);
                socket.emit('error', { message: 'Sender not found' });
                return;
            }

            // Create message object
            const messageObj = {
                from: socket.userCode,
                fromUsername: sender.username,
                message: message,
                timestamp: new Date().toISOString()
            };

            console.log('Created message object:', messageObj);

            // Save message to both users' history
            if (!userData.messages[socket.userCode]) {
                userData.messages[socket.userCode] = {};
            }
            if (!userData.messages[socket.userCode][to]) {
                userData.messages[socket.userCode][to] = [];
            }
            if (!userData.messages[to]) {
                userData.messages[to] = {};
            }
            if (!userData.messages[to][socket.userCode]) {
                userData.messages[to][socket.userCode] = [];
            }

            userData.messages[socket.userCode][to].push(messageObj);
            userData.messages[to][socket.userCode].push(messageObj);
            saveUserData();

            // Send to recipient if online
            const recipient = onlineUsers.get(to);
            if (recipient) {
                console.log('Sending message to recipient:', to);
                io.to(recipient.socketId).emit('newMessage', messageObj);
            } else {
                console.log('Recipient not online:', to);
            }

            // Always send confirmation back to sender
            socket.emit('messageSent', messageObj);

        } catch (error) {
            console.error('Error in chat message:', error);
            socket.emit('error', { message: 'Error sending message' });
        }
    });

    // Handle message deletion
    socket.on('deleteMessage', (data) => {
        try {
            const { messageId, chatWith } = data;
            
            if (!socket.userCode || !chatWith || !messageId) {
                socket.emit('error', { message: 'Invalid delete request' });
                return;
            }

            // Delete message from both users' history
            if (userData.messages[socket.userCode]?.[chatWith]) {
                userData.messages[socket.userCode][chatWith] = userData.messages[socket.userCode][chatWith]
                    .filter(msg => msg.timestamp !== messageId);
            }
            if (userData.messages[chatWith]?.[socket.userCode]) {
                userData.messages[chatWith][socket.userCode] = userData.messages[chatWith][socket.userCode]
                    .filter(msg => msg.timestamp !== messageId);
            }

            saveUserData();

            // Notify both users about the deletion
            socket.emit('messageDeleted', { messageId, chatWith });
            const recipient = onlineUsers.get(chatWith);
            if (recipient) {
                io.to(recipient.socketId).emit('messageDeleted', { messageId, chatWith: socket.userCode });
            }

        } catch (error) {
            console.error('Error deleting message:', error);
            socket.emit('error', { message: 'Error deleting message' });
        }
    });

    // Handle account deletion
    socket.on('deleteAccount', async () => {
        try {
            const userCode = socket.userCode;
            if (!userCode || !userData.users[userCode]) {
                socket.emit('error', { message: 'Invalid delete request' });
                return;
            }

            // Notify all contacts about the account deletion
            if (userData.contacts[userCode]) {
                for (const contactCode of userData.contacts[userCode]) {
                    // Remove user from contact's contact list
                    if (userData.contacts[contactCode]) {
                        userData.contacts[contactCode] = userData.contacts[contactCode]
                            .filter(code => code !== userCode);
                    }
                    
                    // Notify online contacts
                    const contact = onlineUsers.get(contactCode);
                    if (contact) {
                        io.to(contact.socketId).emit('contactDeleted', { code: userCode });
                    }
                }
            }

            // Delete all user data
            delete userData.users[userCode];
            delete userData.contacts[userCode];
            delete userData.messages[userCode];

            // Clean up messages in other users' history
            for (const otherUser in userData.messages) {
                if (userData.messages[otherUser][userCode]) {
                    delete userData.messages[otherUser][userCode];
                }
            }

            saveUserData();

            // Notify success and disconnect
            socket.emit('accountDeleted');
            socket.disconnect();

        } catch (error) {
            console.error('Error deleting account:', error);
            socket.emit('error', { message: 'Error deleting account' });
        }
    });

    // Handle contact removal
    socket.on('removeContact', (data) => {
        try {
            const { contactCode } = data;
            const userCode = socket.userCode;

            if (!userCode || !contactCode) {
                socket.emit('error', { message: 'Invalid request' });
                return;
            }

            // Remove contact from user's list
            if (userData.contacts[userCode]) {
                userData.contacts[userCode] = userData.contacts[userCode]
                    .filter(code => code !== contactCode);
            }

            // Save changes
            saveUserData();

            // Notify success
            socket.emit('contactRemoved', { code: contactCode });

            // Optionally notify the removed contact if they're online
            const removedContact = onlineUsers.get(contactCode);
            if (removedContact) {
                io.to(removedContact.socketId).emit('contactRemovedYou', { 
                    code: userCode,
                    username: userData.users[userCode].username
                });
            }

        } catch (error) {
            console.error('Error removing contact:', error);
            socket.emit('error', { message: 'Error removing contact' });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        if (socket.userCode) {
            onlineUsers.delete(socket.userCode);
        }
        console.log('User disconnected');
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!'
    });
});

const PORT = 3002;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 