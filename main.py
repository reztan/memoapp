# main.py
import http.server
import socketserver
import json
import urllib.parse
from datetime import datetime
import math
import sqlite3
import re

import database

PORT = 8000
DB_NAME = database.DATABASE_NAME

# --- クエリ文字列をパースしてASTに変換する簡易パーサ ---
def tokenize(query):
    tokens = []
    token = ''
    in_quotes = False
    i = 0
    while i < len(query):
        char = query[i]
        if char == '"':
            in_quotes = not in_quotes
            if not in_quotes:
                tokens.append(token.strip())
                token = ''
            i += 1
            continue
        if in_quotes:
            token += char
        elif char in '()':
            if token:
                tokens.append(token.strip())
                token = ''
            tokens.append(char)
        elif char.isspace():
            if token:
                tokens.append(token.strip())
                token = ''
        else:
            token += char
        i += 1
    if token:
        tokens.append(token.strip())
    return tokens

def parse_expression(tokens):
    def parse_operand():
        token = tokens.pop(0)
        if token == '(':
            expr = parse_expression(tokens)
            if not tokens or tokens.pop(0) != ')':
                raise ValueError("Mismatched parenthesis")
            return expr
        elif token.upper() == 'NOT' or token == '-':
            return ('NOT', parse_operand())
        else:
            return token

    def parse_and():
        left = parse_operand()
        while tokens and tokens[0].upper() == 'AND':
            tokens.pop(0)
            right = parse_operand()
            left = ('AND', left, right)
        return left

    def parse_or():
        left = parse_and()
        while tokens and tokens[0].upper() == 'OR':
            tokens.pop(0)
            right = parse_and()
            left = ('OR', left, right)
        return left

    return parse_or()

def parse_query(query):
    tokens = tokenize(query)
    if not tokens:
        return None
    return parse_expression(tokens)

# --- ASTからSQL条件式とパラメータを生成 ---
def build_sql(ast):
    if isinstance(ast, str):
        if ast.startswith('@title:'):
            term = ast[len('@title:'):]
            return "n.title LIKE ?", [f"%{term}%"]
        elif ast.startswith('@body:'):
            term = ast[len('@body:'):]
            return "n.content LIKE ?", [f"%{term}%"]
        elif ast.startswith('@tags:'):
            term = ast[len('@tags:'):]
            return f"EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON nt.tag_id = t.id WHERE nt.note_id = n.id AND t.name = ?)", [term]
        else:
            return "(n.title LIKE ? OR n.content LIKE ?)", [f"%{ast}%", f"%{ast}%"]

    op = ast[0]
    if op == 'AND':
        left_sql, left_params = build_sql(ast[1])
        right_sql, right_params = build_sql(ast[2])
        return f"({left_sql} AND {right_sql})", left_params + right_params
    elif op == 'OR':
        left_sql, left_params = build_sql(ast[1])
        right_sql, right_params = build_sql(ast[2])
        return f"({left_sql} OR {right_sql})", left_params + right_params
    elif op == 'NOT':
        cond_sql, cond_params = build_sql(ast[1])
        return f"NOT ({cond_sql})", cond_params
    else:
        raise ValueError("Invalid AST node")



class MemoHandler(http.server.BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204) # No Content
        self._send_cors_headers()
        self.end_headers()

    def _send_response(self, status_code, data=None, content_type='application/json'):
        self.send_response(status_code)
        self._send_cors_headers()
        self.send_header('Content-type', content_type)
        self.end_headers()
        if data:
            if content_type == 'application/json':
                self.wfile.write(json.dumps(data).encode('utf-8'))
            else:
                self.wfile.write(data)

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        query_components = urllib.parse.parse_qs(parsed_path.query)

        conn = database.get_db_connection()
        cursor = conn.cursor()

        if path == '/':
            try:
                with open('index.html', 'rb') as f:
                    self._send_response(200, f.read(), 'text/html')
            except FileNotFoundError:
                self._send_response(404, {'error': 'index.html not found'})
            return
        elif path.startswith('/static/'):
            try:
                file_path = path[1:] # '/static/' を除去
                content_type = 'text/css' if file_path.endswith('.css') else 'application/javascript'
                with open(file_path, 'rb') as f:
                    self._send_response(200, f.read(), content_type)
            except FileNotFoundError:
                self._send_response(404, {'error': f'{file_path} not found'})
            return

        elif path == '/api/notes' or path == '/api/search/notes':
            page = int(query_components.get('page', [1])[0])
            limit = int(query_components.get('limit', [20])[0])
            offset = (page - 1) * limit
            search_query = query_components.get('query', [''])[0]

            sql = "SELECT DISTINCT n.id, n.title, n.content, n.created_at, n.updated_at FROM notes n "
            count_sql = "SELECT COUNT(DISTINCT n.id) FROM notes n "
            conditions = []
            params = []
            is_trashed = int(query_components.get('trashed', [0])[0])
            conditions.append("n.is_trashed = ?")
            params.append(is_trashed)

            if search_query:
                try:
                    ast = parse_query(search_query)
                    if ast:
                        condition_sql, condition_params = build_sql(ast)
                        conditions.append(condition_sql)
                        params.extend(condition_params)
                except Exception as e:
                    self._send_response(400, {'error': f'Invalid query syntax: {str(e)}'})
                    return


            if conditions:
                sql += " WHERE " + " AND ".join(conditions)
                count_sql += " WHERE " + " AND ".join(conditions)

            sql += " ORDER BY n.updated_at DESC LIMIT ? OFFSET ?"
            params_with_pagination = params + [limit, offset]

            cursor.execute(sql, params_with_pagination)
            notes_rows = cursor.fetchall()
            notes = [dict(row) for row in notes_rows]

            # 各メモにタグ情報を追加
            for note in notes:
                cursor.execute('''
                    SELECT t.name FROM tags t
                    JOIN note_tags nt ON t.id = nt.tag_id
                    WHERE nt.note_id = ?
                ''', (note['id'],))
                note_tags = cursor.fetchall()
                note['tags'] = [{'name': tag['name']} for tag in note_tags]


            cursor.execute(count_sql, params)
            total_items = cursor.fetchone()[0]
            total_pages = math.ceil(total_items / limit)

            self._send_response(200, {'notes': notes, 'total_pages': total_pages, 'current_page': page})

        elif path.startswith('/api/notes/'):
            try:
                note_id = int(path.split('/')[-1]) # /api/notes/{id}
                cursor.execute("SELECT * FROM notes WHERE id = ?", (note_id,))
                note = cursor.fetchone()
                if note:
                    # タグ情報を取得
                    cursor.execute('''
                        SELECT t.name FROM tags t
                        JOIN note_tags nt ON t.id = nt.tag_id
                        WHERE nt.note_id = ?
                    ''', (note_id,))
                    tags = cursor.fetchall()
                    note_data = dict(note)
                    note_data['tags'] = [{'name': tag['name']} for tag in tags]
                    self._send_response(200, note_data)
                else:
                    self._send_response(404, {'error': 'Note not found'})
            except ValueError: # IDが数値でない場合
                self._send_response(400, {'error': 'Invalid note ID'})
            except IndexError: # /api/notes/ の後にIDがない場合
                 self._send_response(400, {'error': 'Note ID missing'})


        elif path == '/api/tags/favorites': # お気に入りタグリスト取得
            cursor.execute('''
                SELECT t.id, t.name, 
                       (SELECT COUNT(nt.note_id) FROM note_tags nt WHERE nt.tag_id = t.id) as memo_count
                FROM tags t
                WHERE t.is_favorite = 1
                ORDER BY t.name ASC
            ''')
            tags_rows = cursor.fetchall()
            tags = [dict(row) for row in tags_rows]
            self._send_response(200, {'tags': tags})

        elif path == '/api/tags/others': # その他タグリスト取得 (旧 /api/tags の役割)
            page = int(query_components.get('page', [1])[0])
            limit = int(query_components.get('limit', [20])[0])
            offset = (page - 1) * limit

            cursor.execute('''
                SELECT t.id, t.name, t.is_favorite,
                       (SELECT COUNT(nt.note_id) FROM note_tags nt WHERE nt.tag_id = t.id) as memo_count
                FROM tags t
                WHERE t.is_favorite = 0
                ORDER BY memo_count DESC, t.name ASC
                LIMIT ? OFFSET ?
            ''', (limit, offset))
            tags_rows = cursor.fetchall()
            tags = [dict(row) for row in tags_rows]

            cursor.execute("SELECT COUNT(id) FROM tags WHERE is_favorite = 0")
            total_items = cursor.fetchone()[0]
            total_pages = math.ceil(total_items / limit) if total_items > 0 else 0

            self._send_response(200, {'tags': tags, 'total_pages': total_pages, 'current_page': page})
        
        elif path == '/api/tags/all': # タグサジェスト用 (変更なし、is_favoriteは含めなくても良い)
            cursor.execute("SELECT id, name FROM tags ORDER BY name ASC")
            tags_rows = cursor.fetchall()
            tags = [dict(row) for row in tags_rows]
            self._send_response(200, {'tags': tags})
        else:
            self._send_response(404, {'error': 'API endpoint not found'})
        conn.close()


    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        try:
            data = json.loads(post_data.decode('utf-8'))
        except json.JSONDecodeError:
            self._send_response(400, {'error': 'Invalid JSON'})
            return

        conn = database.get_db_connection()
        cursor = conn.cursor()
        now = datetime.now().isoformat()

        if self.path == '/api/notes':
            title = data.get('title', '無題のメモ')
            content = data.get('content', '')
            cursor.execute("INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)",
                           (title, content, now, now))
            conn.commit()
            new_note_id = cursor.lastrowid
            # 作成されたメモの情報を返す
            cursor.execute("SELECT * FROM notes WHERE id = ?", (new_note_id,))
            new_note = dict(cursor.fetchone())
            new_note['tags'] = [] # 新規作成時はタグなし
            self._send_response(201, new_note)

        elif self.path.startswith('/api/notes/') and self.path.endswith('/tags'):
            # /api/notes/{id}/tags
            try:
                parts = self.path.split('/')
                note_id = int(parts[3])
                tag_name = data.get('tag_name')
                if not tag_name:
                    self._send_response(400, {'error': 'Tag name is required'})
                    return

                # タグが存在するか確認、なければ作成
                cursor.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                tag_row = cursor.fetchone()
                if tag_row:
                    tag_id = tag_row['id']
                else:
                    cursor.execute("INSERT INTO tags (name) VALUES (?)", (tag_name,))
                    conn.commit()
                    tag_id = cursor.lastrowid

                # note_tagsに関連付け (重複エラーは無視)
                try:
                    cursor.execute("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))
                    conn.commit()
                except sqlite3.IntegrityError: # 既に存在する場合
                    pass

                # 更新後のタグリストを返す
                cursor.execute('''
                    SELECT t.name FROM tags t
                    JOIN note_tags nt ON t.id = nt.tag_id
                    WHERE nt.note_id = ?
                ''', (note_id,))
                tags = [{'name': r['name']} for r in cursor.fetchall()]
                self._send_response(201, {'tags': tags})

            except (ValueError, IndexError):
                self._send_response(400, {'error': 'Invalid note ID for adding tag'})


        else:
            self._send_response(404, {'error': 'API endpoint not found for POST'})
        conn.close()

    def do_PUT(self):
        
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        conn = database.get_db_connection() # PUTの最初でconnを取得
        cursor = conn.cursor()
        now = datetime.now().isoformat()

        if path.startswith('/api/tags/') and path.endswith('/toggle_favorite'):
            # /api/tags/{id}/toggle_favorite
            try:
                tag_id = int(path.split('/')[-2]) # /api/tags/{id}/toggle_favorite
                
                cursor.execute("SELECT is_favorite FROM tags WHERE id = ?", (tag_id,))
                tag_row = cursor.fetchone()
                if not tag_row:
                    self._send_response(404, {'error': 'Tag not found'})
                    conn.close()
                    return
                
                current_is_favorite = tag_row['is_favorite']
                new_is_favorite = 1 if current_is_favorite == 0 else 0
                
                cursor.execute("UPDATE tags SET is_favorite = ? WHERE id = ?", (new_is_favorite, tag_id))
                conn.commit()
                
                # 更新されたタグ情報を返す (memo_countも取得)
                cursor.execute('''
                    SELECT t.id, t.name, t.is_favorite,
                           (SELECT COUNT(nt.note_id) FROM note_tags nt WHERE nt.tag_id = t.id) as memo_count
                    FROM tags t WHERE t.id = ?
                ''', (tag_id,))
                updated_tag_data = dict(cursor.fetchone())
                self._send_response(200, updated_tag_data)

            except (ValueError, IndexError):
                self._send_response(400, {'error': 'Invalid tag ID for toggling favorite'})
            finally: # tryブロックがあってもなくてもconn.close()を実行
                conn.close()
            return # この処理が終わったら他のPUT処理に進まないようにする


        elif path.startswith('/api/notes/') and path.endswith('/trash'):
            try:
                note_id = int(path.split('/')[-2])
                cursor.execute("UPDATE notes SET is_trashed = 1 WHERE id = ?", (note_id,))
                conn.commit()
                self._send_response(200, {'success': True})
            except:
                self._send_response(400, {'error': 'Invalid note ID'})
        
        elif path.startswith('/api/notes/') and path.endswith('/restore'):
            try:
                note_id = int(path.split('/')[-2])
                cursor.execute("UPDATE notes SET is_trashed = 0 WHERE id = ?", (note_id,))
                conn.commit()
                self._send_response(200, {'success': True})
            except:
                self._send_response(400, {'error': 'Invalid ID'})
        elif path.startswith('/api/notes/'):
            content_length = int(self.headers['Content-Length'])
            put_data = self.rfile.read(content_length)
            try:
                data = json.loads(put_data.decode('utf-8'))
            except json.JSONDecodeError:
                self._send_response(400, {'error': 'Invalid JSON'})
                conn.close() # JSONエラーでもconnを閉じる
                return
            try:
                note_id = int(path.split('/')[-1])
                title = data.get('title')
                content = data.get('content')

                if title is None and content is None:
                     self._send_response(400, {'error': 'Title or content is required for update'})
                     conn.close()
                     return

                updates = []
                params = []
                if title is not None:
                    updates.append("title = ?")
                    params.append(title)
                if content is not None:
                    updates.append("content = ?")
                    params.append(content)
                updates.append("updated_at = ?")
                params.append(now)

                params.append(note_id)

                cursor.execute(f"UPDATE notes SET {', '.join(updates)} WHERE id = ?", tuple(params))
                conn.commit()

                if cursor.rowcount == 0:
                    self._send_response(404, {'error': 'Note not found or no changes made'})
                else:
                    cursor.execute("SELECT * FROM notes WHERE id = ?", (note_id,))
                    updated_note = dict(cursor.fetchone())
                    # タグ情報も付加
                    cursor.execute('''
                        SELECT t.name FROM tags t
                        JOIN note_tags nt ON t.id = nt.tag_id
                        WHERE nt.note_id = ?
                    ''', (note_id,))
                    tags_data = cursor.fetchall()
                    updated_note['tags'] = [{'name': tag['name']} for tag in tags_data]
                    self._send_response(200, updated_note)

            except (ValueError, IndexError):
                self._send_response(400, {'error': 'Invalid note ID for update'})
        
        else:
            self._send_response(404, {'error': 'API endpoint not found for PUT'})

        if conn: # connがまだ開いていれば閉じる
            conn.close()

    def do_DELETE(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        conn = database.get_db_connection()
        cursor = conn.cursor()

        if path.startswith('/api/notes/') and path.endswith('/tags/'): # /api/notes/{id}/tags/{tagName}
            # この形式はGETでは使わず、DELETE専用として実装
            # 正しくは /api/notes/{id}/tags/{tagName}
            try:
                parts = path.strip('/').split('/') # ['', 'api', 'notes', '1', 'tags', 'test']
                if len(parts) == 5 and parts[0] == 'api' and parts[1] == 'notes' and parts[3] == 'tags':
                    note_id = int(parts[2])
                    tag_name_encoded = parts[4]
                    tag_name = urllib.parse.unquote(tag_name_encoded) # URLデコード

                    cursor.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                    tag_row = cursor.fetchone()
                    if not tag_row:
                        self._send_response(404, {'error': 'Tag not found'})
                        conn.close()
                        return
                    tag_id = tag_row['id']

                    cursor.execute("DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?", (note_id, tag_id))
                    conn.commit()

                    if cursor.rowcount > 0:
                         # 更新後のタグリストを返す
                        cursor.execute('''
                            SELECT t.name FROM tags t
                            JOIN note_tags nt ON t.id = nt.tag_id
                            WHERE nt.note_id = ?
                        ''', (note_id,))
                        tags = [{'name': r['name']} for r in cursor.fetchall()]
                        self._send_response(200, {'message': 'Tag removed successfully', 'tags': tags})
                    else:
                        self._send_response(404, {'error': 'Tag association not found or already removed'})
                else:
                    self._send_response(400, {'error': 'Invalid URL format for deleting tag'})


            except (ValueError, IndexError):
                self._send_response(400, {'error': 'Invalid note ID or tag name for deleting tag'})

        elif path == '/api/notes/empty_trash':
            print("z")
            cursor.execute("DELETE FROM notes WHERE is_trashed = 1")
            conn.commit()
            self._send_response(200, {'success': True})
        elif path.startswith('/api/notes/'): # /api/notes/{id} (メモ自体の削除)
            print("zz4")
            try:
                note_id = int(path.split('/')[-1])
                # 関連するnote_tagsもCASCADE DELETEで削除されるはず
                cursor.execute("DELETE FROM notes WHERE id = ?", (note_id,))
                conn.commit()
                if cursor.rowcount > 0:
                    self._send_response(200, {'message': 'Note deleted successfully'})
                else:
                    self._send_response(404, {'error': 'Note not found'})
            except (ValueError, IndexError):
                self._send_response(400, {'error': 'Invalid note ID for deletion'})
        else:
            self._send_response(404, {'error': 'API endpoint not found for DELETE'})
        if conn:
            conn.close()


def run(server_class=http.server.HTTPServer, handler_class=MemoHandler, port=PORT):
    # 最初にデータベースを初期化
    database.init_db()
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f"Serving HTTP on port {port}...")
    httpd.serve_forever()

if __name__ == '__main__':
    run()