// static/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const leftPane = document.getElementById('leftPane');
    const rightPane = document.getElementById('rightPane');
    const paneResizer = document.getElementById('paneResizer');
    const toggleLeftPaneButton = document.getElementById('toggleLeftPane');

    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    const newMemoButton = document.getElementById('newMemoButton');
    const memoListEl = document.getElementById('memoList');
    const memoListPaginationEl = document.getElementById('memoListPagination');

    const favoriteTagListEl = document.getElementById('favoriteTagList');
    const otherTagListEl = document.getElementById('tagList');
    const otherTagListPaginationEl = document.getElementById('tagListPagination');

    const fullTextSearchInput = document.getElementById('fullTextSearchInput');
    const tagSearchInput = document.getElementById('tagSearchInput');
    const searchButton = document.getElementById('searchButton');
    const searchResultsEl = document.getElementById('searchResults');
    const searchResultPaginationEl = document.getElementById('searchResultPagination');


    const memoTitleInput = document.getElementById('memoTitle');
    const memoCurrentTagsEl = document.getElementById('memoCurrentTags');
    const memoTagInput = document.getElementById('memoTagInput');
    const tagSuggestionsEl = document.getElementById('tagSuggestions');
    const memoContentInput = document.getElementById('memoContent');
    const markdownPreviewEl = document.getElementById('markdownPreview');
    const toggleMarkdownPreviewButton = document.getElementById('toggleMarkdownPreview');
    const saveStatusEl = document.getElementById('saveStatus');
    const createdAtEl = document.getElementById('createdAt');
    const updatedAtEl = document.getElementById('updatedAt');
    const trashMemoListEl = document.getElementById('trashMemoList');
    const emptyTrashButton = document.getElementById('emptyTrashButton');
    // --- 状態管理 ---
    let currentMemoId = null;
    let isEditingMarkdown = false; // false:編集, true:プレビュー
    let autoSaveTimer = null;
    const AUTO_SAVE_DELAY = 3000; // 3秒操作がなければ自動保存

    let currentMemoListPage = 1;
    const ITEMS_PER_PAGE = 20;
    let currentOtherTagListPage = 1;
    let currentSearchResultPage = 1;

    let allTags = []; // タグ補完用

    // 左ペインの開閉状態を管理するフラグ
    let isLeftPaneClosed = false;

    let lastLeftWidth = leftPane.getBoundingClientRect().width;
    // --- 初期化処理 ---
    initPanes();
    initTabs();
    loadMemos();
    loadFavoriteTags();
    loadOtherTags();
    loadAllTagsForSuggestions();

    // --- ペインリサイズ機能 ---
    function initPanes() {
        let isResizing = false;
        paneResizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', () => {
                isResizing = false;
                document.removeEventListener('mousemove', handleMouseMove);
            });
        });

        function handleMouseMove(e) {
        if (!isResizing || isLeftPaneClosed) return;
            const containerOffsetLeft = document.querySelector('.container').offsetLeft;
            const newLeftWidth = e.clientX - containerOffsetLeft;
            if (newLeftWidth > 150 && newLeftWidth < (document.querySelector('.container').offsetWidth - 150) ) { // 最小幅制限
                leftPane.style.width = `${newLeftWidth}px`;
                lastLeftWidth = newLeftWidth;
            }
        }
    }

    // 左ペインの開閉ボタン
    toggleLeftPaneButton.addEventListener('click', () => {
        isLeftPaneClosed = !isLeftPaneClosed;
        if (isLeftPaneClosed) {
            lastLeftWidth = leftPane.getBoundingClientRect().width;
            leftPane.classList.add('closed');
            leftPane.style.width = '0px';
            toggleLeftPaneButton.textContent = '▶'; // ペインを開くアイコン
        } else {
            leftPane.classList.remove('closed');
            leftPane.style.width = `${lastLeftWidth}px`;
            toggleLeftPaneButton.textContent = '≡'; // ペインを閉じるアイコン
        }
    });
    // --- タブ切り替え機能 ---
    function initTabs() {
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                button.classList.add('active');
                const tabName = button.dataset.tab; 
                document.getElementById(tabName + '-content').classList.add('active');
                document.getElementById(button.dataset.tab + '-content').classList.add('active');
                if (tabName === 'trash-tab') {
                    loadTrashedMemos();
                }
            });
        });
        // 初期表示タブ
        document.querySelector('.tab-button[data-tab="memo-list-tab"]').click();
    }

    // --- API呼び出し ---
    async function fetchData(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.message}`);
            }
            if (response.headers.get("content-type")?.includes("application/json")) {
                return response.json();
            }
            return response.text(); // JSONでない場合も考慮
        } catch (error) {
            console.error('Fetch error:', error);
            saveStatusEl.textContent = `エラー: ${error.message}`;
            saveStatusEl.style.color = 'red';
            return null;
        }
    }

    // --- メモ関連処理 ---
    async function loadMemos(page = 1, query = '', tags = '') {
        currentMemoListPage = page;
        let url = `/api/notes?page=${page}&limit=${ITEMS_PER_PAGE}`;
        if (query) url += `&query=${encodeURIComponent(query)}`;
        if (tags) url += `&tags=${encodeURIComponent(tags)}`;

        const data = await fetchData(url);
        if (data && data.notes) {
            renderMemoList(data.notes, memoListEl);
            renderPagination(data.total_pages, page, memoListPaginationEl, loadMemos, query, tags);
            if (!currentMemoId && data.notes.length > 0) {
                 // 最初のメモを選択状態にするか、何もしないか。今回は何もしない。
            }
        }
    }

    function renderMemoList(memos, targetElement) {
        targetElement.innerHTML = '';
        if (memos.length === 0) {
            targetElement.innerHTML = '<p>メモはありません。</p>';
            return;
        }
        memos.forEach(memo => {
            const div = document.createElement('div');
            div.classList.add('memo-item'); 
            div.dataset.id = memo.id;

            const titleSpan = document.createElement('span');
            titleSpan.textContent = memo.title || '無題のメモ';
            titleSpan.classList.add('memo-title');
            titleSpan.addEventListener('click', () => {
                if (currentMemoId === memo.id) return;
                selectMemo(memo.id);
                // 選択中の強調表示処理
                Array.from(targetElement.children).forEach(child => child.classList.remove('selected'));
                div.classList.add('selected');
            });
            if (memo.id === currentMemoId) {
                div.classList.add('selected');
            }
            const trashBtn = document.createElement('button');
            trashBtn.textContent = '🗑'; // アイコンや文字はお好みで
            trashBtn.classList.add('trash-btn');
            trashBtn.title = 'ゴミ箱に移動';
            trashBtn.addEventListener('click', async (e) => {
                // ボタンをクリックしても親の選択イベントが発火しないようにする
                e.stopPropagation();
                if (!confirm('このメモをゴミ箱に移動しますか？')) return;

                // メモをゴミ箱に移動する API 呼び出し
                const result = await fetchData(`/api/notes/${memo.id}/trash`, {
                    method: 'PUT'
                });
                if (result && result.success) {
                    // ゴミ箱移動後は一覧を再読み込み
                    loadMemos(currentMemoListPage);
                    // 選択中だったらエディタをリセット
                    if (currentMemoId === memo.id) {
                        disableEditor();
                        currentMemoId = null;
                    }
                } else {
                    alert('ゴミ箱への移動に失敗しました。');
                }
            });
            div.appendChild(titleSpan);
            div.appendChild(trashBtn);
            targetElement.appendChild(div);
        });
    }

    async function selectMemo(id) {
        if (autoSaveTimer) clearTimeout(autoSaveTimer); // 保存処理中に他のメモを選択した場合のケア

        const memo = await fetchData(`/api/notes/${id}`);
        if (memo) {
            currentMemoId = memo.id;
            memoTitleInput.value = memo.title;
            memoContentInput.value = memo.content;
            createdAtEl.textContent = new Date(memo.created_at).toLocaleString();
            updatedAtEl.textContent = new Date(memo.updated_at).toLocaleString();
            renderMemoTags(memo.tags || []); // メモのタグを表示

            enableEditor();
            saveStatusEl.textContent = '読み込み完了';
            saveStatusEl.style.color = 'green';
            isEditingMarkdown = false;
            showEditor();

            // メモ一覧で選択状態を更新
            Array.from(memoListEl.children).forEach(child => {
                child.classList.toggle('selected', child.dataset.id == currentMemoId);
            });
             Array.from(searchResultsEl.children).forEach(child => {
                child.classList.toggle('selected', child.dataset.id == currentMemoId);
            });
        }
    }

    newMemoButton.addEventListener('click', async () => {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        const newMemo = await fetchData('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '新しいメモ', content: '' }) // 初期タグなし
        });
        if (newMemo) {
            currentMemoId = newMemo.id;
            memoTitleInput.value = newMemo.title;
            memoContentInput.value = newMemo.content;
            createdAtEl.textContent = new Date(newMemo.created_at).toLocaleString();
            updatedAtEl.textContent = new Date(newMemo.updated_at).toLocaleString();
            renderMemoTags(newMemo.tags || []);
            enableEditor();
            saveStatusEl.textContent = '新規メモ作成完了';
            saveStatusEl.style.color = 'green';
            isEditingMarkdown = false;
            showEditor();
            loadMemos(currentMemoListPage); // メモ一覧を再読み込み
            // 新規作成したメモを選択状態にする
            setTimeout(() => { // DOM更新待機
                const newMemoDiv = memoListEl.querySelector(`div[data-id="${newMemo.id}"]`);
                if (newMemoDiv) {
                    Array.from(memoListEl.children).forEach(child => child.classList.remove('selected'));
                    newMemoDiv.classList.add('selected');
                }
            }, 100);
        }
    });

    function enableEditor() {
        memoTitleInput.disabled = false;
        memoContentInput.disabled = false;
        toggleMarkdownPreviewButton.disabled = false;
        memoTagInput.disabled = false;
    }

    function disableEditor() {
        currentMemoId = null;
        memoTitleInput.value = '';
        memoContentInput.value = '';
        createdAtEl.textContent = '---';
        updatedAtEl.textContent = '---';
        memoTitleInput.disabled = true;
        memoContentInput.disabled = true;
        toggleMarkdownPreviewButton.disabled = true;
        memoTagInput.disabled = true;
        memoCurrentTagsEl.innerHTML = '';
        tagSuggestionsEl.innerHTML = '';
        tagSuggestionsEl.classList.add('hidden');
        isEditingMarkdown = false;
        showEditor(); // 編集画面を表示状態に戻す
        saveStatusEl.textContent = '';
    }
    disableEditor(); // 初期状態は編集不可

    // --- 自動保存 ---
    [memoTitleInput, memoContentInput].forEach(input => {
        input.addEventListener('input', () => {
            if (!currentMemoId) return;
            saveStatusEl.textContent = '編集中...';
            saveStatusEl.style.color = 'orange';
            if (autoSaveTimer) clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(saveCurrentMemo, AUTO_SAVE_DELAY);
        });
    });

    async function saveCurrentMemo() {
        if (!currentMemoId) return;
        saveStatusEl.textContent = '保存中...';
        saveStatusEl.style.color = 'blue';

        const title = memoTitleInput.value;
        const content = memoContentInput.value;
        // タグの保存は別途行うか、ここでまとめて行う
        // ここでは簡単のためタイトルと本文のみ
        const memoData = { title, content };

        const updatedMemo = await fetchData(`/api/notes/${currentMemoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(memoData)
        });

        if (updatedMemo) {
            updatedAtEl.textContent = new Date(updatedMemo.updated_at).toLocaleString();
            saveStatusEl.textContent = '保存済み';
            saveStatusEl.style.color = 'green';
            // メモ一覧のタイトルも更新（もし表示されていれば）
            const memoInList = memoListEl.querySelector(`div[data-id="${currentMemoId}"]`);
            if (memoInList) memoInList.textContent = updatedMemo.title || '無題のメモ';
            const memoInSearch = searchResultsEl.querySelector(`div[data-id="${currentMemoId}"]`);
            if (memoInSearch) memoInSearch.textContent = updatedMemo.title || '無題のメモ';

        } else {
            saveStatusEl.textContent = '保存失敗';
            saveStatusEl.style.color = 'red';
        }
        autoSaveTimer = null;
    }

    // --- Markdownプレビュー ---
    toggleMarkdownPreviewButton.addEventListener('click', () => {
        if (!currentMemoId) return;
        isEditingMarkdown = !isEditingMarkdown;
        if (isEditingMarkdown) {
            renderMarkdown(memoContentInput.value);
            showPreview();
            toggleMarkdownPreviewButton.textContent = '✎';
            toggleMarkdownPreviewButton.title = '編集';
        } else {
            showEditor();
            toggleMarkdownPreviewButton.textContent = '👁︎';
            toggleMarkdownPreviewButton.title = 'Markdownプレビュー';
        }
    });

    function showEditor() {
        memoContentInput.classList.remove('hidden');
        markdownPreviewEl.classList.add('hidden');
    }
    function showPreview() {
        memoContentInput.classList.add('hidden');
        markdownPreviewEl.classList.remove('hidden');
    }

    function renderMarkdown(mdText) {
        // `marked.parse` で一気に Markdown → HTML に変換
        markdownPreviewEl.innerHTML = marked.parse(mdText);
    }


    // --- タグ関連処理 ---
    async function loadAllTagsForSuggestions() {
        const data = await fetchData('/api/tags/all'); // 全タグを取得するAPI (ページングなし)
        if (data && data.tags) {
            allTags = data.tags.map(tag => tag.name);
        }
    }

    memoTagInput.addEventListener('input', () => {
        if (!currentMemoId) return;
        const inputText = memoTagInput.value.toLowerCase();
        tagSuggestionsEl.innerHTML = '';
        if (inputText.length > 0) {
            const suggestions = allTags.filter(tag => tag.toLowerCase().includes(inputText));
            if (suggestions.length > 0) {
                suggestions.slice(0, 5).forEach(suggestion => { // 最大5件表示
                    const div = document.createElement('div');
                    div.textContent = suggestion;
                    div.addEventListener('click', () => {
                        addTagToCurrentMemo(suggestion);
                        memoTagInput.value = '';
                        tagSuggestionsEl.classList.add('hidden');
                    });
                    tagSuggestionsEl.appendChild(div);
                });
                tagSuggestionsEl.classList.remove('hidden');
            } else {
                tagSuggestionsEl.classList.add('hidden');
            }
        } else {
            tagSuggestionsEl.classList.add('hidden');
        }
    });
    // どこかをクリックしたらサジェストを閉じる
    document.addEventListener('click', (e) => {
        if (!tagSuggestionsEl.contains(e.target) && e.target !== memoTagInput) {
            tagSuggestionsEl.classList.add('hidden');
        }
    });


    memoTagInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && currentMemoId && memoTagInput.value.trim() !== '') {
            e.preventDefault();
            const tagName = memoTagInput.value.trim();
            addTagToCurrentMemo(tagName);
            memoTagInput.value = '';
            tagSuggestionsEl.classList.add('hidden');
        }
    });

    async function addTagToCurrentMemo(tagName) {
        if (!currentMemoId || !tagName) return;
        const result = await fetchData(`/api/notes/${currentMemoId}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_name: tagName })
        });
        if (result && result.tags) {
            renderMemoTags(result.tags);
            loadFavoriteTags();
            loadOtherTags(currentOtherTagListPage); 
            loadAllTagsForSuggestions(); 
            if (autoSaveTimer) clearTimeout(autoSaveTimer); 
            autoSaveTimer = setTimeout(saveCurrentMemo, AUTO_SAVE_DELAY); 
        }
    }

    async function removeTagFromCurrentMemo(tagName) {
        if (!currentMemoId || !tagName) return;
        const result = await fetchData(`/api/notes/${currentMemoId}/tags/${encodeURIComponent(tagName)}`, {
            method: 'DELETE'
        });
        if (result && result.tags) {
            renderMemoTags(result.tags);
            loadFavoriteTags();
            loadOtherTags(currentOtherTagListPage);
            if (autoSaveTimer) clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(saveCurrentMemo, AUTO_SAVE_DELAY);
        }
    }

    function renderMemoTags(tags) {
        memoCurrentTagsEl.innerHTML = '';
        tags.forEach(tag => {
            const span = document.createElement('span');
            span.classList.add('tag-chip');
            span.textContent = tag.name;
            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'x';
            removeBtn.style.marginLeft = '5px';
            removeBtn.style.border = 'none';
            removeBtn.style.background = 'transparent';
            removeBtn.style.cursor = 'pointer';
            removeBtn.onclick = (e) => {
                e.stopPropagation(); // 親要素へのイベント伝播を止める
                removeTagFromCurrentMemo(tag.name);
            };
            span.appendChild(removeBtn);
            memoCurrentTagsEl.appendChild(span);
        });
    }
    async function loadFavoriteTags() {
        const data = await fetchData('/api/tags/favorites');
        if (data && data.tags) {
            renderTagList(data.tags, favoriteTagListEl, true); // isFavoriteList = true
        } else {
            favoriteTagListEl.innerHTML = '<p>お気に入りタグはありません。</p>';
        }
    }
    async function loadOtherTags(page = 1) {
        currentOtherTagListPage = page;
        const data = await fetchData(`/api/tags/others?page=${page}&limit=${ITEMS_PER_PAGE}`);
        if (data && data.tags) {
            renderTagList(data.tags, otherTagListEl, false); // isFavoriteList = false
            renderPagination(data.total_pages, page, otherTagListPaginationEl, loadOtherTags);
        } else {
            otherTagListEl.innerHTML = '<p>その他のタグはありません。</p>';
            renderPagination(0, 1, otherTagListPaginationEl, loadOtherTags); // ページネーションクリア
        }
    }

    function renderTagList(tags, targetElement, isFavoriteList) {
        targetElement.innerHTML = '';
        if (tags.length === 0) {
            targetElement.innerHTML = `<p>${isFavoriteList ? ' ' : 'その他のタグはありません。'}</p>`;
            return;
        }
        tags.forEach(tag => {
            const div = document.createElement('div');
            div.classList.add('tag-item'); // CSS適用のため

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('tag-name');
            nameSpan.textContent = `${tag.name} (${tag.memo_count})`;
            nameSpan.dataset.tagName = tag.name;
            nameSpan.addEventListener('click', () => {
                document.querySelector('.tab-button[data-tab="search-tab"]').click();
                fullTextSearchInput.value = '';
                tagSearchInput.value = tag.name;
                performSearch(1);
            });

            const toggleBtn = document.createElement('button');
            toggleBtn.classList.add('favorite-toggle-btn');
            toggleBtn.dataset.tagId = tag.id;
            if (isFavoriteList) {
                toggleBtn.textContent = '★';
                toggleBtn.title = 'お気に入りから解除';
            } else {
                toggleBtn.textContent = '☆';
                toggleBtn.title = 'お気に入りに追加';
            }            
            toggleBtn.addEventListener('click', async () => {
                await toggleFavoriteStatus(tag.id);
            });

            div.appendChild(nameSpan);
            div.appendChild(toggleBtn);
            targetElement.appendChild(div);
        });
    }
    
    async function toggleFavoriteStatus(tagId) {
        const updatedTag = await fetchData(`/api/tags/${tagId}/toggle_favorite`, {
            method: 'PUT'
        });
        if (updatedTag) {
            // 両方のリストを再読み込みして表示を更新
            await loadFavoriteTags();
            await loadOtherTags(currentOtherTagListPage); // 現在のページを維持して再読み込み
            // TODO: もしタグサジェストが is_favorite に依存するなら loadAllTagsForSuggestions() も呼ぶ
        } else {
            saveStatusEl.textContent = 'お気に入り状態の更新に失敗しました。';
            saveStatusEl.style.color = 'red';
        }
    }

    // --- 検索処理 ---
    searchButton.addEventListener('click', () => performSearch(1));
    fullTextSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            performSearch(1);
        }
    });
    tagSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            performSearch(1);
        }
    });
    async function performSearch(page = 1) {
        currentSearchResultPage = page;
        const query = fullTextSearchInput.value.trim();
        const tags = tagSearchInput.value.trim();

        if (!query && !tags) {
            searchResultsEl.innerHTML = '<p>検索キーワードまたはタグを入力してください。</p>';
            renderPagination(0, 1, searchResultPaginationEl, performSearch); // ページネーションをクリア
            return;
        }

        let url = `/api/search/notes?page=${page}&limit=${ITEMS_PER_PAGE}`;
        if (query) url += `&query=${encodeURIComponent(query)}`;
        if (tags) url += `&tags=${encodeURIComponent(tags)}`;

        const data = await fetchData(url);
        if (data && data.notes) {
            renderMemoList(data.notes, searchResultsEl);
            renderPagination(data.total_pages, page, searchResultPaginationEl, performSearch);
            // 検索結果タブに切り替え & メモ一覧タブの選択を解除
            if (document.querySelector('.tab-button[data-tab="search-tab"]').classList.contains('active')) {
                 Array.from(memoListEl.children).forEach(child => child.classList.remove('selected'));
            }
        } else {
            searchResultsEl.innerHTML = '<p>検索結果はありませんでした。</p>';
            renderPagination(0, 1, searchResultPaginationEl, performSearch);
        }
    }

    
    async function loadTrashedMemos() {
        const data = await fetchData('/api/notes?trashed=1');
        if (data && data.notes) {
            trashMemoListEl.innerHTML = '';
            data.notes.forEach(note => {
                const div = document.createElement('div');
                div.textContent = note.title;
                const restoreBtn = document.createElement('button');
                restoreBtn.textContent = '復元';
                restoreBtn.onclick = async () => {
                    await fetchData(`/api/notes/${note.id}/restore`, { method: 'PUT' });
                    loadTrashedMemos();
                    loadMemos();
                };
                div.appendChild(restoreBtn);
                trashMemoListEl.appendChild(div);
            });
        }
    }

    emptyTrashButton.addEventListener('click', async () => {
        if (confirm('本当にゴミ箱を空にしますか？')) {
            await fetchData('/api/notes/empty_trash', { method: 'DELETE' });
            loadTrashedMemos();
        }
    });

    // --- ページネーション描画 ---
    function renderPagination(totalPages, currentPage, PagerElement, callback, ...args) {
        PagerElement.innerHTML = '';
        if (totalPages <= 1) return;

        const prevButton = document.createElement('button');
        prevButton.textContent = '前へ';
        prevButton.disabled = currentPage === 1;
        if (prevButton.disabled) prevButton.classList.add('disabled');
        prevButton.addEventListener('click', () => {
            if (currentPage > 1) callback(currentPage - 1, ...args);
        });
        PagerElement.appendChild(prevButton);

        const pageInfo = document.createElement('span');
        pageInfo.textContent = `${currentPage} / ${totalPages}`;
        PagerElement.appendChild(pageInfo);

        const nextButton = document.createElement('button');
        nextButton.textContent = '次へ';
        nextButton.disabled = currentPage === totalPages;
        if (nextButton.disabled) nextButton.classList.add('disabled');
        nextButton.addEventListener('click', () => {
            if (currentPage < totalPages) callback(currentPage + 1, ...args);
        });
        PagerElement.appendChild(nextButton);
    }
});