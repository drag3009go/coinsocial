from pydantic import BaseModel
from typing import Optional

class UserCreate(BaseModel):
    username: str
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class Post(BaseModel):
    id: str
    user_id: str
    username: str
    content: str
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    likes: int = 0
    dislikes: int = 0
    comments_count: int = 0
    timestamp: str

class Comment(BaseModel):
    id: str
    post_id: str
    user_id: str
    username: str
    content: str
    timestamp: str

class Message(BaseModel):
    id: str
    sender_id: str
    receiver_id: str
    sender_username: str
    content: str
    timestamp: str
    is_read: bool = False

class Conversation(BaseModel):
    user_id: str
    username: str
    avatar_url: Optional[str]
    last_message: str
    timestamp: str
    unread_count: int = 0