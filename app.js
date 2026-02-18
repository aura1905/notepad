/* ===== Aura Notepad - Main Application ===== */

(function () {
    'use strict';

    // ===== State =====
    let tabs = [];
    let activeTabId = null;
    let tabCounter = 0;
    let wordWrap = false;
    let fontSize = 13;
    let autoSaveTimer = null;
    const FONT_SIZE_MIN = 8;
    const FONT_SIZE_MAX = 32;

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
            scrollLeft: 0
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
        // Save current tab state
        if (activeTabId) {
            const current = getTab(activeTabId);
            if (current) {
                current.content = editor.value;
                current.cursorPos = { start: editor.selectionStart, end: editor.selectionEnd };
                current.scrollTop = editor.scrollTop;
                current.scrollLeft = editor.scrollLeft;
            }
        }

        activeTabId = id;
        const tab = getTab(id);
        if (!tab) return;

        // Update editor
        editor.value = tab.content;
        editor.selectionStart = tab.cursorPos.start;
        editor.selectionEnd = tab.cursorPos.end;
        editor.scrollTop = tab.scrollTop;
        editor.scrollLeft = tab.scrollLeft;
        editor.focus();

        // Update tab UI
        document.querySelectorAll('.tab').forEach(el => {
            el.classList.toggle('active', el.dataset.id === id);
        });

        updateLineNumbers();
        updateStatusBar();
    }

    function closeTab(id) {
        const tab = getTab(id);
        if (!tab) return;

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
        const text = editor.value;
        const pos = editor.selectionStart;

        // Calculate line and column
        const beforeCursor = text.substring(0, pos);
        const lines = beforeCursor.split('\n');
        const line = lines.length;
        const col = lines[lines.length - 1].length + 1;

        statusPosition.textContent = `줄 ${line}, 열 ${col}`;
        statusChars.textContent = `${text.length.toLocaleString()} 글자`;
        statusLines.textContent = `${text.split('\n').length} 줄`;

        // Modified indicator
        const tab = getTab(activeTabId);
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
        } else {
            lineNumbers.style.display = '';
        }
        showToast(wordWrap ? '자동 줄 바꿈 켜짐' : '자동 줄 바꿈 꺼짐');
    }

    // ===== Font Size =====
    function setFontSize(size) {
        fontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size));
        editor.style.fontSize = fontSize + 'px';
        lineNumbers.style.fontSize = fontSize + 'px';
        $('#font-size-display').textContent = fontSize + 'px';
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
    }

    function saveToLocalStorage() {
        // Save current editor content
        const current = getTab(activeTabId);
        if (current) {
            current.content = editor.value;
        }

        const data = {
            tabs: tabs.map(t => ({
                id: t.id,
                name: t.name,
                content: t.content,
                originalContent: t.originalContent
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
                    scrollLeft: 0
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

        // Try to restore from LocalStorage
        const restored = loadFromLocalStorage();
        if (!restored) {
            createTab('환영합니다.txt', `🎉 Aura Notepad에 오신 것을 환영합니다!

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
