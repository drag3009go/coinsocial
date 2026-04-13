import os
import uuid
from datetime import datetime
from supabase import create_client, Client
from PIL import Image
import io

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise Exception("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

BUCKET_MEDIA = "media"
BUCKET_AVATARS = "avatars"

def init_storage_buckets():
    """Создаёт публичные бакеты если их нет"""
    for bucket in [BUCKET_MEDIA, BUCKET_AVATARS]:
        try:
            supabase.storage.create_bucket(bucket, {"public": True})
        except:
            pass

def compress_image(file_bytes, max_size=(1200, 1200), quality=85):
    """Сжимает изображение, возвращает bytes"""
    img = Image.open(io.BytesIO(file_bytes))
    img.thumbnail(max_size, Image.LANCZOS)
    output = io.BytesIO()
    img.save(output, format='JPEG', quality=quality, optimize=True)
    return output.getvalue()

def upload_file(file_bytes, filename, content_type, is_avatar=False):
    """Загружает файл в Supabase Storage и возвращает публичный URL"""
    bucket = BUCKET_AVATARS if is_avatar else BUCKET_MEDIA
    ext = os.path.splitext(filename)[1]
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = unique_name

    # Сжимаем только изображения (не аватары, чтобы сохранить качество)
    if content_type.startswith("image/") and not is_avatar:
        file_bytes = compress_image(file_bytes)

    supabase.storage.from_(bucket).upload(file_path, file_bytes, {"content-type": content_type})
    public_url = supabase.storage.from_(bucket).get_public_url(file_path)
    return public_url

def delete_file(file_url):
    """Удаляет файл по публичному URL"""
    # URL: https://.../storage/v1/object/public/media/uuid.jpg
    parts = file_url.split('/public/')
    if len(parts) < 2:
        return
    bucket_and_path = parts[1]
    bucket = bucket_and_path.split('/')[0]
    path = '/'.join(bucket_and_path.split('/')[1:])
    try:
        supabase.storage.from_(bucket).remove([path])
    except Exception as e:
        print(f"Delete error: {e}")
