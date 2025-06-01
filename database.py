# database.py
import sqlite3
from datetime import datetime

DATABASE_NAME = 'memo.db'

def get_db_connection():
    """データベース接続を取得します。"""
    conn = sqlite3.connect(DATABASE_NAME)
    conn.row_factory = sqlite3.Row # カラム名でアクセスできるようにする
    return conn

def init_db():
    """データベースを初期化し、テーブルを作成します。"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # notesテーブル
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '無題のメモ',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_trashed INTEGER NOT NULL DEFAULT 0
    )
    ''')

    # tagsテーブル
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        is_favorite INTEGER NOT NULL DEFAULT 0
    )
    ''')

    # note_tagsテーブル (中間テーブル)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS note_tags (
        note_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, tag_id)
    )
    ''')
    conn.commit()
    conn.close()
    print("Database initialized.")

if __name__ == '__main__':
    init_db() # スクリプトとして直接実行された場合にDBを初期化