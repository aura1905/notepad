/* ===== Nabi Notepad - Main Application ===== */

// ===== Firebase Config =====
const firebaseConfig = {
    apiKey: "AIzaSyCx9Et77K4bWe8Gt2EaFFs4x1-qgYXn4d4",
    authDomain: "gdd-presentation-ddb3c.firebaseapp.com",
    projectId: "gdd-presentation-ddb3c",
    storageBucket: "gdd-presentation-ddb3c.firebasestorage.app",
    messagingSenderId: "276123425066",
    appId: "1:276123425066:web:390e40bb764d78fb976653",
    measurementId: "G-46E0BQYD3C"
};

if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
}

(function () {
    'use strict';

    // ===== State =====
    let tabs = [];
    let activeTabId = null;
    let tabCounter = 0;
    let wordWrap = false;
    let fontSize = 13;
    let autoSaveTimer = null;
    let previewMode = 'off'; // 'off', 'split', 'full'
    const FONT_SIZE_MIN = 8;
    const FONT_SIZE_MAX = 32;

    // ===== Firebase / Sync State =====
    const auth = (typeof firebase !== 'undefined') ? firebase.auth() : null;
    const db = (typeof firebase !== 'undefined') ? firebase.firestore() : null;
    const clientId = Math.random().toString(36).slice(2) + '-' + Date.now();
    let currentUser = null;
    let firestoreUnsub = null;
    let cloudSaveTimer = null;
    let isApplyingRemoteChange = false;
    let initialCloudLoadDone = false;

    // ===== DOM Elements =====
    const $ = (sel) => document.querySelector(sel);
    const tabsContainer = $('#tabs-container');
    const editor = $('#editor');
    const lineNumbers = $('#line-numbers');
    const statusPosition = $('#status-position');
    const statusChars = $('#status-chars');
    const statusLines = $('#status-lines');
    const statusModified = $('#status-modified');
    const statusSaved = $('#status-saved');
    const findPanel = $('#find-panel');
    const findInput = $('#find-input');
    const replaceInput = $('#replace-input');
    const findCount = $('#find-count');
    const fileInput = $('#file-input');
    const previewPane = $('#preview-pane');
    const statusSync = $('#status-sync');
    const userInfo = $('#user-info');
    const userAvatar = $('#user-avatar');
    const userName = $('#user-name');
    const btnLogin = $('#btn-login');
    const btnLogout = $('#btn-logout');
    const btnMdMode = $('#btn-mdmode');
    const mdContainer = $('#md-editor-container');
    const mdSource = $('#md-source');
    let mdEditor = null;

    // ===== Markdown helpers =====
    function isMdName(name) {
        if (!name) return false;
        return /\.(md|markdown|mdx)$/i.test(name);
    }

    function ensureMdEditor() {
        if (mdEditor) return mdEditor;
        if (typeof HyperMD === 'undefined' || typeof CodeMirror === 'undefined') {
            return null;
        }
        mdEditor = HyperMD.fromTextArea(mdSource, {
            lineNumbers: false,
            gutters: [],
            foldGutter: false,
            autoCloseBrackets: true,
            lineWrapping: true
        });
        mdEditor.on('change', () => {
            if (isApplyingRemoteChange) return;
            const tab = getTab(activeTabId);
            if (!tab || !tab.mdMode) return;
            tab.content = mdEditor.getValue();
            updateTabModified(tab);
            updateStatusBar();
            renderPreview();
            scheduleAutoSave();
        });
        mdEditor.on('cursorActivity', updateStatusBar);
        return mdEditor;
    }

    function isMdActive() {
        const tab = getTab(activeTabId);
        return !!(tab && tab.mdMode);
    }

    // ===== Tab Management =====
    function createTab(name = null, content = '') {
        tabCounter++;
        const id = `tab-${Date.now()}-${tabCounter}`;
        const tab = {
            id,
            name: name || `제목 없음 ${tabCounter}`,
            content,
            originalContent: content,
            cursorPos: { start: 0, end: 0 },
            scrollTop: 0,
            scrollLeft: 0,
            mdMode: isMdName(name)
        };
        tabs.push(tab);
        renderTab(tab);
        switchTab(id);
        scheduleAutoSave();
        return tab;
    }

    function renderTab(tab) {
        const el = document.createElement('div');
        el.className = 'tab';
        el.dataset.id = tab.id;
        el.innerHTML = `
            <span class="tab-title">${escapeHtml(tab.name)}</span>
            <span class="tab-modified"></span>
            <button class="tab-close" title="닫기">✕</button>
        `;
        el.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                switchTab(tab.id);
            }
        });
        el.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });
        // Double-click to rename
        el.querySelector('.tab-title').addEventListener('dblclick', (e) => {
            e.stopPropagation();
            renameTab(tab.id);
        });
        tabsContainer.appendChild(el);
    }

    function switchTab(id) {
        // Save current tab state from whichever editor was active
        if (activeTabId) {
            const current = getTab(activeTabId);
            if (current) {
                if (current.mdMode && mdEditor) {
                    current.content = mdEditor.getValue();
                } else {
                    current.content = editor.value;
                    current.cursorPos = { start: editor.selectionStart, end: editor.selectionEnd };
                    current.scrollTop = editor.scrollTop;
                    current.scrollLeft = editor.scrollLeft;
                }
            }
        }

        activeTabId = id;
        const tab = getTab(id);
        if (!tab) return;

        // Update tab UI
        document.querySelectorAll('.tab').forEach(el => {
            el.classList.toggle('active', el.dataset.id === id);
        });

        if (tab.mdMode) {
            const cm = ensureMdEditor();
            if (cm) {
                cm.setValue(tab.content || '');
                setTimeout(() => { cm.refresh(); cm.focus(); }, 0);
            } else {
                // HyperMD not loaded — fall back to text mode for this tab
                tab.mdMode = false;
                editor.value = tab.content;
                editor.focus();
                showToast('마크다운 에디터 로드 실패, 텍스트 모드로 전환', 'warning');
            }
        } else {
            editor.value = tab.content;
            editor.selectionStart = tab.cursorPos.start;
            editor.selectionEnd = tab.cursorPos.end;
            editor.scrollTop = tab.scrollTop;
            editor.scrollLeft = tab.scrollLeft;
            editor.focus();
        }

        if (btnMdMode) btnMdMode.classList.toggle('active', !!tab.mdMode);

        updateLineNumbers();
        updateStatusBar();
        updatePreviewLayout();
        renderPreview();
    }

    function toggleMdMode() {
        const tab = getTab(activeTabId);
        if (!tab) return;
        // Save current content from whichever editor before flipping
        if (tab.mdMode && mdEditor) {
            tab.content = mdEditor.getValue();
        } else {
            tab.content = editor.value;
        }
        tab.mdMode = !tab.mdMode;
        // Force re-render via switchTab
        const id = activeTabId;
        activeTabId = null;
        switchTab(id);
        scheduleAutoSave();
        showToast(tab.mdMode ? '마크다운 라이브 편집 모드' : '텍스트 모드');
    }

    function closeTab(id) {
        const tab = getTab(id);
        if (!tab) return;

        // Sync content from active editor if closing active tab
        if (id === activeTabId) {
            if (tab.mdMode && mdEditor) {
                tab.content = mdEditor.getValue();
            } else {
                tab.content = editor.value;
            }
        }

        // Check if modified
        if (tab.content !== tab.originalContent) {
            if (!confirm(`"${tab.name}" 파일이 변경되었습니다. 저장하지 않고 닫으시겠습니까?`)) {
                return;
            }
        }

        // Remove tab
        const idx = tabs.findIndex(t => t.id === id);
        tabs.splice(idx, 1);
        const el = tabsContainer.querySelector(`[data-id="${id}"]`);
        if (el) el.remove();

        // Switch to nearby tab or create new
        if (tabs.length === 0) {
            createTab();
        } else if (activeTabId === id) {
            const newIdx = Math.min(idx, tabs.length - 1);
            switchTab(tabs[newIdx].id);
        }
        scheduleAutoSave();
    }

    function renameTab(id) {
        const tab = getTab(id);
        if (!tab) return;
        const newName = prompt('문서 이름 변경:', tab.name);
        if (newName && newName.trim()) {
            tab.name = newName.trim();
            const el = tabsContainer.querySelector(`[data-id="${id}"] .tab-title`);
            if (el) el.textContent = tab.name;
            scheduleAutoSave();
        }
    }

    function getTab(id) {
        return tabs.find(t => t.id === id);
    }

    // ===== File Operations =====
    function newFile() {
        createTab();
        showToast('새 문서가 생성되었습니다', 'success');
    }

    function openFile() {
        fileInput.click();
    }

    function handleFileSelect(e) {
        const files = e.target.files;
        if (!files.length) return;

        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                createTab(file.name, ev.target.result);
                showToast(`"${file.name}" 파일을 열었습니다`, 'success');
            };
            reader.readAsText(file);
        });
        fileInput.value = '';
    }

    function saveFile() {
        const tab = getTab(activeTabId);
        if (!tab) return;

        // Sync content
        tab.content = editor.value;

        const blob = new Blob([tab.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = tab.name.endsWith('.txt') ? tab.name : `${tab.name}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        tab.originalContent = tab.content;
        updateTabModified(tab);
        showToast(`"${tab.name}" 파일이 저장되었습니다`, 'success');
        scheduleAutoSave();
    }

    // ===== Drag & Drop =====
    function setupDragDrop() {
        const editorArea = $('#editor-area');

        editorArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            editorArea.style.outline = `2px dashed var(--accent)`;
            editorArea.style.outlineOffset = '-4px';
        });

        editorArea.addEventListener('dragleave', () => {
            editorArea.style.outline = '';
            editorArea.style.outlineOffset = '';
        });

        editorArea.addEventListener('drop', (e) => {
            e.preventDefault();
            editorArea.style.outline = '';
            editorArea.style.outlineOffset = '';

            const files = e.dataTransfer.files;
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    createTab(file.name, ev.target.result);
                    showToast(`"${file.name}" 파일을 열었습니다`, 'success');
                };
                reader.readAsText(file);
            });
        });
    }

    // ===== Editor =====
    function updateLineNumbers() {
        const text = editor.value;
        const lines = text.split('\n');
        const count = lines.length;
        let html = '';
        for (let i = 1; i <= count; i++) {
            html += `<div>${i}</div>`;
        }
        lineNumbers.innerHTML = html;
    }

    function syncLineNumberScroll() {
        lineNumbers.scrollTop = editor.scrollTop;
    }

    function updateStatusBar() {
        const tab = getTab(activeTabId);
        let text, line, col;
        if (tab && tab.mdMode && mdEditor) {
            text = mdEditor.getValue();
            const cursor = mdEditor.getCursor();
            line = cursor.line + 1;
            col = cursor.ch + 1;
        } else {
            text = editor.value;
            const pos = editor.selectionStart;
            const beforeCursor = text.substring(0, pos);
            const lines = beforeCursor.split('\n');
            line = lines.length;
            col = lines[lines.length - 1].length + 1;
        }

        statusPosition.textContent = `줄 ${line}, 열 ${col}`;
        statusChars.textContent = `${text.length.toLocaleString()} 글자`;
        statusLines.textContent = `${text.split('\n').length} 줄`;

        if (tab) {
            updateTabModified(tab);
        }
    }

    function updateTabModified(tab) {
        const isModified = tab.content !== tab.originalContent;
        const el = tabsContainer.querySelector(`[data-id="${tab.id}"]`);
        if (el) {
            el.classList.toggle('modified', isModified);
        }
        statusModified.textContent = isModified ? '● 수정됨' : '';
    }

    function handleTab(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const value = editor.value;

            if (e.shiftKey) {
                // Unindent
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const lineText = value.substring(lineStart, start);
                if (lineText.startsWith('    ')) {
                    editor.value = value.substring(0, lineStart) + value.substring(lineStart + 4);
                    editor.selectionStart = editor.selectionEnd = start - 4;
                } else if (lineText.startsWith('\t')) {
                    editor.value = value.substring(0, lineStart) + value.substring(lineStart + 1);
                    editor.selectionStart = editor.selectionEnd = start - 1;
                }
            } else {
                // Indent
                editor.value = value.substring(0, start) + '    ' + value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
            }

            updateLineNumbers();
            updateStatusBar();
            onContentChange();
        }
    }

    function onContentChange() {
        const tab = getTab(activeTabId);
        if (tab) {
            tab.content = editor.value;
            updateTabModified(tab);
        }
        updateLineNumbers();
        updateStatusBar();
        renderPreview();
        scheduleAutoSave();
    }

    // ===== Word Wrap =====
    function toggleWordWrap() {
        wordWrap = !wordWrap;
        editor.classList.toggle('word-wrap', wordWrap);
        const btn = $('#btn-wordwrap');
        btn.classList.toggle('active', wordWrap);

        if (wordWrap) {
            lineNumbers.style.display = 'none';
        } else if (!isMdActive()) {
            lineNumbers.style.display = '';
        }
        if (mdEditor) mdEditor.setOption('lineWrapping', wordWrap);
        showToast(wordWrap ? '자동 줄 바꿈 켜짐' : '자동 줄 바꿈 꺼짐');
    }

    // ===== Font Size =====
    function setFontSize(size) {
        fontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size));
        editor.style.fontSize = fontSize + 'px';
        lineNumbers.style.fontSize = fontSize + 'px';
        $('#font-size-display').textContent = fontSize + 'px';
        if (mdContainer) mdContainer.style.fontSize = fontSize + 'px';
        if (mdEditor) mdEditor.refresh();
        updateLineNumbers();
        scheduleAutoSave();
    }

    function increaseFontSize() {
        setFontSize(fontSize + 1);
        showToast(`글꼴 크기: ${fontSize}px`);
    }

    function decreaseFontSize() {
        setFontSize(fontSize - 1);
        showToast(`글꼴 크기: ${fontSize}px`);
    }

    // ===== Markdown Preview =====
    function togglePreview() {
        if (previewMode === 'off') {
            previewMode = 'split';
            showToast('분할 프리뷰 모드');
        } else if (previewMode === 'split') {
            previewMode = 'full';
            showToast('전체 프리뷰 모드');
        } else {
            previewMode = 'off';
            showToast('편집 모드');
        }
        updatePreviewLayout();
        renderPreview();
    }

    function updatePreviewLayout() {
        const btn = $('#btn-preview');
        btn.classList.toggle('active', previewMode !== 'off');

        const inMdMode = isMdActive();
        const showWriting = previewMode !== 'full';

        if (showWriting) {
            if (inMdMode) {
                editor.style.display = 'none';
                lineNumbers.style.display = 'none';
                mdContainer.classList.remove('hidden');
            } else {
                editor.style.display = '';
                lineNumbers.style.display = wordWrap ? 'none' : '';
                mdContainer.classList.add('hidden');
            }
        } else {
            editor.style.display = 'none';
            lineNumbers.style.display = 'none';
            mdContainer.classList.add('hidden');
        }

        if (previewMode === 'off') {
            previewPane.classList.add('hidden');
            previewPane.classList.remove('fullscreen');
        } else if (previewMode === 'split') {
            previewPane.classList.remove('hidden');
            previewPane.classList.remove('fullscreen');
        } else {
            previewPane.classList.remove('hidden');
            previewPane.classList.add('fullscreen');
        }
    }

    function renderPreview() {
        if (previewMode === 'off') return;

        const tab = getTab(activeTabId);
        const content = (tab && tab.mdMode && mdEditor) ? mdEditor.getValue() : editor.value;
        const name = tab ? tab.name.toLowerCase() : '';

        if (name.endsWith('.json')) {
            try {
                const parsed = JSON.parse(content);
                previewPane.innerHTML = '<pre><code>' + escapeHtml(JSON.stringify(parsed, null, 2)) + '</code></pre>';
            } catch (e) {
                previewPane.innerHTML = '<div style="color:var(--danger);padding:12px;">⚠️ JSON 파싱 오류: ' + escapeHtml(e.message) + '</div>' +
                    '<pre><code>' + escapeHtml(content) + '</code></pre>';
            }
        } else if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdx')) {
            if (typeof marked !== 'undefined') {
                marked.setOptions({ breaks: true, gfm: true });
                previewPane.innerHTML = marked.parse(content);
            } else {
                previewPane.innerHTML = '<p style="color:var(--warning);">marked.js 로딩 중...</p>';
            }
        } else if (name.endsWith('.html') || name.endsWith('.htm')) {
            previewPane.innerHTML = content;
        } else {
            previewPane.innerHTML = '<pre style="white-space:pre-wrap;word-wrap:break-word;">' + escapeHtml(content) + '</pre>';
        }
    }

    // ===== Find & Replace =====
    function toggleFindPanel() {
        const hidden = findPanel.classList.toggle('hidden');
        if (!hidden) {
            // Copy selected text into find input
            const selected = editor.value.substring(editor.selectionStart, editor.selectionEnd);
            if (selected) findInput.value = selected;
            findInput.focus();
            findInput.select();
            updateFindCount();
        } else {
            editor.focus();
        }
    }

    function updateFindCount() {
        const query = findInput.value;
        if (!query) {
            findCount.textContent = '0개 결과';
            return 0;
        }
        try {
            const flags = $('#find-case').checked ? 'g' : 'gi';
            const isRegex = $('#find-regex').checked;
            const pattern = isRegex ? query : escapeRegex(query);
            const regex = new RegExp(pattern, flags);
            const matches = editor.value.match(regex);
            const count = matches ? matches.length : 0;
            findCount.textContent = `${count}개 결과`;
            return count;
        } catch (e) {
            findCount.textContent = '잘못된 정규식';
            return 0;
        }
    }

    function findNext() {
        const query = findInput.value;
        if (!query) return;
        try {
            const flags = $('#find-case').checked ? 'g' : 'gi';
            const isRegex = $('#find-regex').checked;
            const pattern = isRegex ? query : escapeRegex(query);
            const regex = new RegExp(pattern, flags);
            regex.lastIndex = editor.selectionEnd;
            let match = regex.exec(editor.value);
            if (!match) {
                regex.lastIndex = 0;
                match = regex.exec(editor.value);
            }
            if (match) {
                editor.selectionStart = match.index;
                editor.selectionEnd = match.index + match[0].length;
                editor.focus();
                // Scroll into view
                scrollEditorToSelection();
            }
        } catch (e) { /* ignore */ }
    }

    function findPrev() {
        const query = findInput.value;
        if (!query) return;
        try {
            const flags = $('#find-case').checked ? 'g' : 'gi';
            const isRegex = $('#find-regex').checked;
            const pattern = isRegex ? query : escapeRegex(query);
            const regex = new RegExp(pattern, flags);
            let lastMatch = null;
            let match;
            while ((match = regex.exec(editor.value)) !== null) {
                if (match.index >= editor.selectionStart) break;
                lastMatch = match;
            }
            if (!lastMatch) {
                // Wrap: find last occurrence
                regex.lastIndex = 0;
                while ((match = regex.exec(editor.value)) !== null) {
                    lastMatch = match;
                }
            }
            if (lastMatch) {
                editor.selectionStart = lastMatch.index;
                editor.selectionEnd = lastMatch.index + lastMatch[0].length;
                editor.focus();
                scrollEditorToSelection();
            }
        } catch (e) { /* ignore */ }
    }

    function replaceOne() {
        const query = findInput.value;
        const replacement = replaceInput.value;
        if (!query) return;

        const selected = editor.value.substring(editor.selectionStart, editor.selectionEnd);
        const flags = $('#find-case').checked ? '' : 'i';
        const isRegex = $('#find-regex').checked;
        const pattern = isRegex ? query : escapeRegex(query);
        const regex = new RegExp(pattern, flags);

        if (regex.test(selected)) {
            const start = editor.selectionStart;
            editor.value = editor.value.substring(0, start) + replacement + editor.value.substring(editor.selectionEnd);
            editor.selectionStart = start;
            editor.selectionEnd = start + replacement.length;
            onContentChange();
        }
        findNext();
        updateFindCount();
    }

    function replaceAll() {
        const query = findInput.value;
        const replacement = replaceInput.value;
        if (!query) return;
        try {
            const flags = $('#find-case').checked ? 'g' : 'gi';
            const isRegex = $('#find-regex').checked;
            const pattern = isRegex ? query : escapeRegex(query);
            const regex = new RegExp(pattern, flags);
            const count = updateFindCount();
            editor.value = editor.value.replace(regex, replacement);
            onContentChange();
            updateFindCount();
            showToast(`${count}개 항목이 바뀌었습니다`, 'success');
        } catch (e) { /* ignore */ }
    }

    function scrollEditorToSelection() {
        const text = editor.value.substring(0, editor.selectionStart);
        const lines = text.split('\n');
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
        const targetScroll = (lines.length - 5) * lineHeight;
        editor.scrollTop = Math.max(0, targetScroll);
    }

    // ===== Theme =====
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const newTheme = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('notepad-theme', newTheme);

        const iconMoon = $('#icon-moon');
        const iconSun = $('#icon-sun');
        iconMoon.style.display = newTheme === 'light' ? 'none' : '';
        iconSun.style.display = newTheme === 'light' ? '' : 'none';

        showToast(newTheme === 'light' ? '라이트 테마' : '다크 테마');
    }

    function loadTheme() {
        const saved = localStorage.getItem('notepad-theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
            const iconMoon = $('#icon-moon');
            const iconSun = $('#icon-sun');
            iconMoon.style.display = saved === 'light' ? 'none' : '';
            iconSun.style.display = saved === 'light' ? '' : 'none';
        }
    }

    // ===== Auto Save (LocalStorage) =====
    function scheduleAutoSave() {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            saveToLocalStorage();
        }, 1000);
        scheduleCloudSave();
    }

    function saveToLocalStorage() {
        // Save current editor content from whichever editor is active
        const current = getTab(activeTabId);
        if (current) {
            if (current.mdMode && mdEditor) {
                current.content = mdEditor.getValue();
            } else {
                current.content = editor.value;
            }
        }

        const data = {
            tabs: tabs.map(t => ({
                id: t.id,
                name: t.name,
                content: t.content,
                originalContent: t.originalContent,
                mdMode: !!t.mdMode
            })),
            activeTabId,
            tabCounter,
            wordWrap,
            fontSize
        };
        try {
            localStorage.setItem('notepad-data', JSON.stringify(data));
            statusSaved.textContent = '자동 저장됨';
            statusSaved.style.color = 'var(--success)';
            setTimeout(() => {
                statusSaved.style.color = '';
            }, 1500);
        } catch (e) {
            console.warn('LocalStorage save failed:', e);
            statusSaved.textContent = '저장 실패';
            statusSaved.style.color = 'var(--danger)';
        }
    }

    function loadFromLocalStorage() {
        try {
            const raw = localStorage.getItem('notepad-data');
            if (!raw) return false;

            const data = JSON.parse(raw);
            if (!data.tabs || !data.tabs.length) return false;

            tabCounter = data.tabCounter || 0;
            wordWrap = data.wordWrap || false;
            fontSize = data.fontSize || 13;

            data.tabs.forEach(t => {
                const tab = {
                    id: t.id,
                    name: t.name,
                    content: t.content,
                    originalContent: t.originalContent || t.content,
                    cursorPos: { start: 0, end: 0 },
                    scrollTop: 0,
                    scrollLeft: 0,
                    mdMode: typeof t.mdMode === 'boolean' ? t.mdMode : isMdName(t.name)
                };
                tabs.push(tab);
                renderTab(tab);
            });

            // Restore word wrap
            if (wordWrap) {
                editor.classList.add('word-wrap');
                $('#btn-wordwrap').classList.add('active');
                lineNumbers.style.display = 'none';
            }

            // Restore font size
            setFontSize(fontSize);

            // Restore active tab
            const targetId = data.activeTabId;
            if (tabs.find(t => t.id === targetId)) {
                switchTab(targetId);
            } else {
                switchTab(tabs[0].id);
            }

            return true;
        } catch (e) {
            console.warn('LocalStorage load failed:', e);
            return false;
        }
    }

    // ===== Firebase Sync =====
    function setSyncStatus(state, text) {
        if (!statusSync) return;
        statusSync.classList.remove('syncing', 'synced', 'error');
        if (state) statusSync.classList.add(state);
        statusSync.textContent = text || '';
    }

    function updateAuthUI() {
        if (currentUser) {
            btnLogin.classList.add('hidden');
            userInfo.classList.remove('hidden');
            userAvatar.src = currentUser.photoURL || '';
            userAvatar.style.display = currentUser.photoURL ? '' : 'none';
            userName.textContent = currentUser.displayName || currentUser.email || '사용자';
        } else {
            btnLogin.classList.remove('hidden');
            userInfo.classList.add('hidden');
        }
    }

    function login() {
        if (!auth) {
            showToast('Firebase 초기화 실패', 'warning');
            return;
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(e => {
            console.warn('Login failed:', e);
            showToast('로그인 실패: ' + (e.message || e.code), 'warning');
        });
    }

    function logout() {
        if (!auth) return;
        auth.signOut().then(() => {
            showToast('로그아웃되었습니다');
        });
    }

    function buildCloudPayload() {
        // Sync current editor content to active tab first
        const current = getTab(activeTabId);
        if (current) {
            if (current.mdMode && mdEditor) {
                current.content = mdEditor.getValue();
            } else {
                current.content = editor.value;
            }
        }

        return {
            tabs: tabs.map(t => ({
                id: t.id,
                name: t.name,
                content: t.content,
                originalContent: t.originalContent,
                mdMode: !!t.mdMode
            })),
            activeTabId,
            tabCounter,
            wordWrap,
            fontSize,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtClient: Date.now(),
            clientId
        };
    }

    function applyRemoteData(data) {
        if (!data || !Array.isArray(data.tabs)) return;

        isApplyingRemoteChange = true;
        try {
            // Save current editor state to active tab before rebuild (so unsaved local input not in remote isn't lost — but remote wins on conflicting tab content)
            // We simply replace state with remote.
            tabs = [];
            tabsContainer.innerHTML = '';
            tabCounter = data.tabCounter || 0;

            data.tabs.forEach(t => {
                const tab = {
                    id: t.id,
                    name: t.name,
                    content: t.content || '',
                    originalContent: t.originalContent || t.content || '',
                    cursorPos: { start: 0, end: 0 },
                    scrollTop: 0,
                    scrollLeft: 0,
                    mdMode: typeof t.mdMode === 'boolean' ? t.mdMode : isMdName(t.name)
                };
                tabs.push(tab);
                renderTab(tab);
            });

            if (typeof data.wordWrap === 'boolean') {
                wordWrap = data.wordWrap;
                editor.classList.toggle('word-wrap', wordWrap);
                $('#btn-wordwrap').classList.toggle('active', wordWrap);
                lineNumbers.style.display = wordWrap ? 'none' : '';
            }

            if (typeof data.fontSize === 'number') {
                setFontSize(data.fontSize);
            }

            if (tabs.length === 0) {
                createTab();
            } else {
                const targetId = data.activeTabId && tabs.find(t => t.id === data.activeTabId)
                    ? data.activeTabId
                    : tabs[0].id;
                activeTabId = null;
                switchTab(targetId);
            }

            // Persist locally too
            saveToLocalStorage();
        } finally {
            isApplyingRemoteChange = false;
        }
    }

    async function loadFromFirestoreOnce() {
        if (!currentUser || !db) return false;
        try {
            setSyncStatus('syncing', '☁ 불러오는 중');
            const snap = await db.collection('users').doc(currentUser.uid).get();
            if (snap.exists) {
                applyRemoteData(snap.data());
                setSyncStatus('synced', '☁ 동기화됨');
                return true;
            } else {
                // First login on this account: upload current local state
                setSyncStatus('synced', '☁ 새 클라우드');
                await saveToFirestore();
                return false;
            }
        } catch (e) {
            console.warn('Firestore load failed:', e);
            setSyncStatus('error', '☁ 로드 실패');
            return false;
        }
    }

    function subscribeToFirestore() {
        if (!currentUser || !db) return;
        if (firestoreUnsub) firestoreUnsub();
        firestoreUnsub = db.collection('users').doc(currentUser.uid)
            .onSnapshot((doc) => {
                if (!doc.exists) return;
                if (doc.metadata.hasPendingWrites) return; // Our own pending write
                if (!initialCloudLoadDone) return; // Skip until initial load done
                const data = doc.data();
                if (data && data.clientId === clientId) return; // Self-echo from our own committed write
                applyRemoteData(data);
            }, (e) => {
                console.warn('Firestore listener error:', e);
                setSyncStatus('error', '☁ 연결 끊김');
            });
    }

    function unsubscribeFromFirestore() {
        if (firestoreUnsub) {
            firestoreUnsub();
            firestoreUnsub = null;
        }
    }

    function scheduleCloudSave() {
        if (!currentUser || !db) return;
        if (isApplyingRemoteChange) return;
        clearTimeout(cloudSaveTimer);
        cloudSaveTimer = setTimeout(() => {
            saveToFirestore();
        }, 1500);
    }

    async function saveToFirestore() {
        if (!currentUser || !db) return;
        if (isApplyingRemoteChange) return;
        try {
            setSyncStatus('syncing', '☁ 저장 중');
            const payload = buildCloudPayload();
            await db.collection('users').doc(currentUser.uid).set(payload, { merge: false });
            setSyncStatus('synced', '☁ 동기화됨');
        } catch (e) {
            console.warn('Firestore save failed:', e);
            setSyncStatus('error', '☁ 저장 실패');
        }
    }

    function setupAuth() {
        if (!auth) {
            setSyncStatus('error', '☁ 사용 불가');
            return;
        }
        auth.onAuthStateChanged(async (user) => {
            currentUser = user;
            updateAuthUI();
            if (user) {
                initialCloudLoadDone = false;
                await loadFromFirestoreOnce();
                initialCloudLoadDone = true;
                subscribeToFirestore();
            } else {
                unsubscribeFromFirestore();
                initialCloudLoadDone = false;
                setSyncStatus('', '');
            }
        });
    }

    // ===== Toast =====
    function showToast(message, type = '') {
        // Remove existing
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // ===== Utils =====
    function escapeHtml(str) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, c => map[c]);
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ===== Keyboard Shortcuts =====
    function handleKeyboard(e) {
        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && e.key === 'n') {
            e.preventDefault();
            newFile();
        } else if (ctrl && e.key === 'o') {
            e.preventDefault();
            openFile();
        } else if (ctrl && e.key === 's') {
            e.preventDefault();
            saveFile();
        } else if (ctrl && (e.key === 'h' || e.key === 'f')) {
            e.preventDefault();
            toggleFindPanel();
        } else if (ctrl && e.key === 'w') {
            e.preventDefault();
            if (activeTabId) closeTab(activeTabId);
        } else if (ctrl && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            increaseFontSize();
        } else if (ctrl && e.key === '-') {
            e.preventDefault();
            decreaseFontSize();
        } else if (ctrl && e.key === 'p') {
            e.preventDefault();
            togglePreview();
        } else if (ctrl && e.key === 'm') {
            e.preventDefault();
            toggleMdMode();
        } else if (e.key === 'Escape') {
            if (!findPanel.classList.contains('hidden')) {
                findPanel.classList.add('hidden');
                editor.focus();
            }
        }
    }

    // ===== Event Bindings =====
    function bindEvents() {
        // Toolbar buttons
        $('#btn-new').addEventListener('click', newFile);
        $('#btn-open').addEventListener('click', openFile);
        $('#btn-save').addEventListener('click', saveFile);
        $('#btn-find').addEventListener('click', toggleFindPanel);
        $('#btn-wordwrap').addEventListener('click', toggleWordWrap);
        $('#btn-add-tab').addEventListener('click', newFile);
        $('#btn-theme').addEventListener('click', toggleTheme);
        $('#btn-font-increase').addEventListener('click', increaseFontSize);
        $('#btn-font-decrease').addEventListener('click', decreaseFontSize);
        $('#btn-preview').addEventListener('click', togglePreview);
        if (btnMdMode) btnMdMode.addEventListener('click', toggleMdMode);
        if (btnLogin) btnLogin.addEventListener('click', login);
        if (btnLogout) btnLogout.addEventListener('click', logout);

        // File input
        fileInput.addEventListener('change', handleFileSelect);

        // Editor
        editor.addEventListener('input', onContentChange);
        editor.addEventListener('scroll', syncLineNumberScroll);
        editor.addEventListener('keydown', handleTab);
        editor.addEventListener('click', updateStatusBar);
        editor.addEventListener('keyup', updateStatusBar);

        // Find panel
        findInput.addEventListener('input', updateFindCount);
        $('#find-next').addEventListener('click', findNext);
        $('#find-prev').addEventListener('click', findPrev);
        $('#find-close').addEventListener('click', () => {
            findPanel.classList.add('hidden');
            editor.focus();
        });
        $('#replace-one').addEventListener('click', replaceOne);
        $('#replace-all').addEventListener('click', replaceAll);

        // Find input Enter key
        findInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.shiftKey ? findPrev() : findNext();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboard);

        // Warn on unload
        window.addEventListener('beforeunload', (e) => {
            saveToLocalStorage();
            const hasModified = tabs.some(t => t.content !== t.originalContent);
            if (hasModified) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    // ===== Init =====
    function init() {
        loadTheme();
        bindEvents();
        setupDragDrop();
        setupAuth();

        // Try to restore from LocalStorage
        const restored = loadFromLocalStorage();
        if (!restored) {
            createTab('환영합니다.txt', `🎉 Nabi Notepad에 오신 것을 환영합니다!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  기본 사용법
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 단축키:
  • Ctrl + N : 새 문서 만들기
  • Ctrl + O : 파일 열기
  • Ctrl + S : 파일 저장 (다운로드)
  • Ctrl + W : 현재 탭 닫기
  • Ctrl + F : 찾기/바꾸기
  • Tab      : 들여쓰기

📌 기능:
  • 드래그 앤 드롭으로 파일 열기
  • 탭 이름 더블클릭으로 이름 변경
  • 자동 저장 (새로고침해도 유지)
  • 다크/라이트 테마 전환

이 문서를 자유롭게 편집해보세요! ✍️
`);
        }
    }

    // Start
    init();
})();
