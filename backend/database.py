import os
import bcrypt
import json
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor

def get_db_connection():
    """Подключение к PostgreSQL через отдельные переменные окружения"""
    host = os.getenv("PGHOST")
    port = os.getenv("PGPORT", "5432")
    dbname = os.getenv("PGDATABASE")
    user = os.getenv("PGUSER")
    password = os.getenv("PGPASSWORD")
    sslmode = os.getenv("PGSSLMODE", "require")

    if not all([host, dbname, user, password]):
        raise Exception("Missing database environment variables (PGHOST, PGDATABASE, PGUSER, PGPASSWORD)")

    conn = psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
        sslmode=sslmode,
        cursor_factory=RealDictCursor
    )
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # users
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            avatar_url TEXT,
            coins INTEGER DEFAULT 100,
            created_at TIMESTAMP NOT NULL,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # posts
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            media_url TEXT,
            media_type TEXT,
            likes INTEGER DEFAULT 0,
            dislikes INTEGER DEFAULT 0,
            timestamp TIMESTAMP NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')

    # comments
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            parent_comment_id TEXT,
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (parent_comment_id) REFERENCES comments (id) ON DELETE CASCADE
        )
    ''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id)")

    # post_reactions
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS post_reactions (
            user_id TEXT NOT NULL,
            post_id TEXT NOT NULL,
            reaction_type TEXT NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            PRIMARY KEY (user_id, post_id),
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')

    # messages
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL,
            receiver_id TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            is_read BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')

    # uploaded_files
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS uploaded_files (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            bucket TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            user_id TEXT,
            post_id TEXT,
            is_avatar BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
        )
    ''')

    # push_subscriptions (добавлено)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            user_id TEXT PRIMARY KEY,
            subscription JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    ''')

    # индексы
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON posts(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_uploaded_files_created ON uploaded_files(created_at)')

    conn.commit()
    conn.close()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def save_uploaded_file(file_id, url, bucket, user_id, post_id=None, is_avatar=False):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO uploaded_files (id, url, bucket, created_at, user_id, post_id, is_avatar) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (file_id, url, bucket, datetime.now().isoformat(), user_id, post_id, is_avatar)
    )
    conn.commit()
    conn.close()

def delete_old_files(older_than_hours=92):
    from backend.storage import delete_file
    conn = get_db_connection()
    cursor = conn.cursor()
    cutoff = (datetime.now() - timedelta(hours=older_than_hours)).isoformat()
    cursor.execute("SELECT id, url, bucket FROM uploaded_files WHERE is_avatar = FALSE AND created_at < %s", (cutoff,))
    old_files = cursor.fetchall()
    for file in old_files:
        delete_file(file["url"])
        cursor.execute("DELETE FROM uploaded_files WHERE id = %s", (file["id"],))
    conn.commit()
    conn.close()

# ---------- Push-уведомления ----------
def save_push_subscription(user_id: str, subscription: dict):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO push_subscriptions (user_id, subscription, updated_at)
        VALUES (%s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE
        SET subscription = EXCLUDED.subscription, updated_at = CURRENT_TIMESTAMP
    """, (user_id, json.dumps(subscription)))
    conn.commit()
    conn.close()

def get_push_subscription(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT subscription FROM push_subscriptions WHERE user_id = %s", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return json.loads(row["subscription"])
    return None
