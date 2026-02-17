import sqlite3
import bcrypt
from datetime import datetime
import os

def get_db_connection():
    """Создает и возвращает соединение с базой данных"""
    conn = sqlite3.connect('social.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Пользователи
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            avatar_url TEXT,
            coins INTEGER DEFAULT 100,
            created_at TEXT NOT NULL
        )
    ''')
    
    # Посты
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            media_url TEXT,
            media_type TEXT,
            likes INTEGER DEFAULT 0,
            dislikes INTEGER DEFAULT 0,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')
    
    # Комментарии
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')
    
    # Реакции на посты
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS post_reactions (
            user_id TEXT NOT NULL,
            post_id TEXT NOT NULL,
            reaction_type TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            PRIMARY KEY (user_id, post_id),
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')
    
    # Личные сообщения
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL,
            receiver_id TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            is_read BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')
    
    # Индексы для улучшения производительности
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON posts(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)')
    
    conn.commit()
    conn.close()

def hash_password(password: str) -> str:
    """Хеширует пароль"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Проверяет пароль с хешем"""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def create_upload_folders():
    """Создает папки для загрузки файлов"""
    folders = ['uploads/images', 'uploads/videos', 'uploads/avatars']
    for folder in folders:
        os.makedirs(folder, exist_ok=True)

# Функция для выполнения SQL запросов (удобная обертка)
def execute_query(query: str, params: tuple = (), fetchone: bool = False, fetchall: bool = False):
    """Выполняет SQL запрос и возвращает результат"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute(query, params)
        
        if fetchone:
            result = cursor.fetchone()
        elif fetchall:
            result = cursor.fetchall()
        else:
            result = None
        
        conn.commit()
        return result
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

# Функция для получения пользователя по ID
def get_user_by_id(user_id: str):
    """Получает пользователя по ID"""
    return execute_query(
        "SELECT id, username, email, avatar_url, coins, created_at FROM users WHERE id = ?",
        (user_id,),
        fetchone=True
    )

# Функция для получения пользователя по email
def get_user_by_email(email: str):
    """Получает пользователя по email"""
    return execute_query(
        "SELECT id, username, email, password_hash, avatar_url, coins FROM users WHERE email = ?",
        (email,),
        fetchone=True
    )

# Функция для создания нового пользователя
def create_user(user_id: str, username: str, email: str, password_hash: str):
    """Создает нового пользователя"""
    return execute_query(
        """INSERT INTO users (id, username, email, password_hash, created_at) 
           VALUES (?, ?, ?, ?, ?)""",
        (user_id, username, email, password_hash, datetime.now().isoformat())
    )