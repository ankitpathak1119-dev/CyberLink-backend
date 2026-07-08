const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Ensure base uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function getChatDirectory(userId, contactId) {
  const dir = path.join(UPLOADS_DIR, String(userId), 'chats', String(contactId));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    // Also create media subdirectories
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  }
  return dir;
}

function getGroupDirectory(userId, groupId) {
  const dir = path.join(UPLOADS_DIR, String(userId), 'groups', String(groupId));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  }
  return dir;
}

function saveMessageToFile(userId, peerId, isGroup, messageObj) {
  try {
    const dir = isGroup ? getGroupDirectory(userId, peerId) : getChatDirectory(userId, peerId);
    const messagesFile = path.join(dir, 'messages.json');
    
    let messages = [];
    if (fs.existsSync(messagesFile)) {
      const data = fs.readFileSync(messagesFile, 'utf8');
      if (data) {
        messages = JSON.parse(data);
      }
    }
    
    messages.push(messageObj);
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving message to file:', error);
    return false;
  }
}

function getMessagesFromFile(userId, peerId, isGroup) {
  try {
    const dir = isGroup ? getGroupDirectory(userId, peerId) : getChatDirectory(userId, peerId);
    const messagesFile = path.join(dir, 'messages.json');
    
    if (fs.existsSync(messagesFile)) {
      const data = fs.readFileSync(messagesFile, 'utf8');
      return data ? JSON.parse(data) : [];
    }
    return [];
  } catch (error) {
    console.error('Error reading messages from file:', error);
    return [];
  }
}

function syncUserStorage(userId) {
  const result = { chats: {}, groups: {} };
  
  try {
    const userDir = path.join(UPLOADS_DIR, String(userId));
    if (!fs.existsSync(userDir)) return result;

    const chatsDir = path.join(userDir, 'chats');
    if (fs.existsSync(chatsDir)) {
      const contacts = fs.readdirSync(chatsDir);
      for (const contact of contacts) {
        const msgsFile = path.join(chatsDir, contact, 'messages.json');
        if (fs.existsSync(msgsFile)) {
          const data = fs.readFileSync(msgsFile, 'utf8');
          result.chats[contact] = data ? JSON.parse(data) : [];
        }
      }
    }

    const groupsDir = path.join(userDir, 'groups');
    if (fs.existsSync(groupsDir)) {
      const groups = fs.readdirSync(groupsDir);
      for (const group of groups) {
        const msgsFile = path.join(groupsDir, group, 'messages.json');
        if (fs.existsSync(msgsFile)) {
          const data = fs.readFileSync(msgsFile, 'utf8');
          result.groups[group] = data ? JSON.parse(data) : [];
        }
      }
    }
  } catch (error) {
    console.error('Error syncing user storage:', error);
  }
  
  return result;
}

module.exports = {
  getChatDirectory,
  getGroupDirectory,
  saveMessageToFile,
  getMessagesFromFile,
  syncUserStorage,
  UPLOADS_DIR
};
