document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    let isAuthenticated = false;
    let isGenerating = false;

    // --- Element Cache ---
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-button');
    const provinceSelect = document.getElementById('province-select');
    const rankInput = document.getElementById('rank-input');
    const scoreTypeGroup = document.querySelector('input[name="score_type"]:checked');
    const usageStats = document.getElementById('usage-stats');
    
    // Modal elements
    const modalOverlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal');
    const modalInput = document.getElementById('modal-input');
    const modalSubmit = document.getElementById('modal-submit');
    const modalError = document.getElementById('modal-error');
    const mainContainer = document.querySelector('.container');

    // --- Initial State ---
    initializePage();
    setupEventListeners();

    // --- Initialization ---
    async function initializePage() {
        try {
            const response = await fetch('/api/usage');
            if (!response.ok) throw new Error('Failed to fetch usage stats.');
            
            const data = await response.json();
            updateUsage(data);

            if (data.used >= data.limit) {
                showModalWithMessage("非常抱歉，今日的免费体验名额已被抢完！请您明日再来。", true);
            } else {
                showModal();
            }
        } catch (error) {
            console.error("Failed to fetch initial usage:", error);
            showModalWithMessage("无法连接到服务器，请稍后刷新重试。", true);
        }
    }

    function setupEventListeners() {
        sendButton.addEventListener('click', sendMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        modalSubmit.addEventListener('click', handleModalSubmit);
        modalInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleModalSubmit();
        });
        // Auto-resize textarea
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = (chatInput.scrollHeight) + 'px';
        });
    }

    // --- Modal Logic ---
    function showModal() {
        mainContainer.style.filter = 'blur(5px)';
        modalOverlay.classList.add('visible');
        modalInput.focus();
    }

    function hideModal() {
        mainContainer.style.filter = 'none';
        modalOverlay.classList.remove('visible');
    }

    function showModalWithMessage(message, isError = true) {
        modal.innerHTML = `
            <h2 style="color: ${isError ? '#DC3545' : '#007BFF'}">${isError ? '<i class="fas fa-exclamation-triangle"></i>' : '<i class="fas fa-info-circle"></i>'} 操作受限</h2>
            <p>${message}</p>
        `;
        showModal();
    }

    async function handleModalSubmit() {
        const code = modalInput.value.trim();
        if (!code) {
            modalError.textContent = '邀请码不能为空。';
            return;
        }

        modalSubmit.disabled = true;
        modalSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        modalError.textContent = '';

        try {
            const response = await fetch('/api/verify_code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invitationCode: code })
            });
            const data = await response.json();
            if (data.success) {
                isAuthenticated = true;
                hideModal();
                appendBotMessage("认证成功！我是高考志愿AI决策顾问，请输入您的方案和困惑，开始分析吧。");
            } else {
                modalError.textContent = data.error || '验证失败。';
            }
        } catch (error) {
            modalError.textContent = '验证请求失败，请检查网络。';
        } finally {
            modalSubmit.disabled = false;
            modalSubmit.textContent = '验证';
        }
    }

    // --- Chat Logic ---
    function appendUserMessage(text) {
        const msgDiv = document.createElement("div");
        msgDiv.className = "message user-message";
        msgDiv.textContent = text;
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function appendBotMessage(htmlContent) {
        const msgDiv = document.createElement("div");
        msgDiv.className = "message bot-message";
        const markdownContent = document.createElement("div");
        markdownContent.className = "markdown-content";
        markdownContent.innerHTML = htmlContent;
        msgDiv.appendChild(markdownContent);
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return msgDiv;
    }

    async function sendMessage() {
        if (isGenerating || !isAuthenticated) return;

        const userInputText = chatInput.value.trim();
        if (!userInputText) return;

        isGenerating = true;
        sendButton.disabled = true;
        chatInput.value = "";
        chatInput.style.height = 'auto';

        appendUserMessage(userInputText);

        const botMessageDiv = appendBotMessage('<div class="typing-cursor"></div>');
        const scoreType = document.querySelector('input[name="score_type"]:checked').value;

        const requestBody = {
            userInput: {
                rawText: userInputText,
                province: provinceSelect.value,
                rank: rankInput.value,
                scoreType: scoreType
            },
            sessionId: sessionId,
            invitationCode: modalInput.value.trim()
        };

        let mode = 'thinking';
        let thinkAccumulator = '';
        let answerAccumulator = '';
        let thinkContentWrapper, thinkContentDiv, toggleThink;

        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok || !response.body) {
                const errorData = await response.json();
                botMessageDiv.innerHTML = `<div class="markdown-content" style="color: red;">错误: ${errorData.error || response.statusText}</div>`;
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let boundary = buffer.indexOf('\n\n');

                while (boundary !== -1) {
                    const message = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2);

                    if (message.startsWith('event: message')) {
                        const data = message.substring(message.indexOf('data: ') + 6);
                        let token = JSON.parse(data);

                        if (mode === 'thinking') {
                            if (!thinkContentWrapper) {
                                // Create think block structure on first think token
                                botMessageDiv.innerHTML = `
                                    <div class="think-container">
                                        <div class="toggle-think">
                                            <i class="fas fa-brain"></i> AI思考中... <i class="fas fa-chevron-down"></i>
                                        </div>
                                        <div class="think-content-wrapper">
                                            <div class="markdown-content"></div>
                                        </div>
                                    </div>
                                    <div class="answer-content-wrapper markdown-content"></div>
                                `;
                                thinkContentWrapper = botMessageDiv.querySelector('.think-content-wrapper');
                                thinkContentDiv = thinkContentWrapper.querySelector('.markdown-content');
                                toggleThink = botMessageDiv.querySelector('.toggle-think');
                                toggleThink.addEventListener('click', () => {
                                    thinkContentWrapper.classList.toggle('expanded');
                                    toggleThink.classList.toggle('expanded');
                                });
                            }

                            if (token.includes('</think>')) {
                                const parts = token.split('</think>');
                                thinkAccumulator += parts[0];
                                answerAccumulator += parts[1];
                                mode = 'answering';
                                toggleThink.innerHTML = `<i class="fas fa-check-circle"></i> 思考完成 <i class="fas fa-chevron-down"></i>`;
                            } else {
                                thinkAccumulator += token;
                            }
                        } else {
                            answerAccumulator += token;
                        }

                        const finalThink = thinkAccumulator.replace('<think>', '');
                        if (thinkContentDiv) {
                            thinkContentDiv.innerHTML = marked.parse(finalThink + (mode === 'thinking' ? ' ▍' : ''));
                        }
                        
                        const answerWrapper = botMessageDiv.querySelector('.answer-content-wrapper');
                        if (answerWrapper) {
                            answerWrapper.innerHTML = marked.parse(answerAccumulator + (mode === 'answering' ? ' ▍' : ''));
                        }

                    } else if (message.startsWith('event: usage')) {
                        const data = message.substring(message.indexOf('data: ') + 6);
                        updateUsage(JSON.parse(data));
                    } else if (message.startsWith('event: end')) {
                        break; // Exit inner loop
                    }
                    boundary = buffer.indexOf('\n\n');
                }
                if (done) break; // Exit outer loop
            }

        } catch (error) {
            console.error("Submit/Fetch Error:", error);
            botMessageDiv.innerHTML = `<div class="markdown-content" style="color: red;">请求失败: ${error.message}</div>`;
        } finally {
            isGenerating = false;
            sendButton.disabled = false;
            // Final cleanup of content and cursors
            const finalThinkDiv = botMessageDiv.querySelector('.think-content-wrapper .markdown-content');
            if(finalThinkDiv) finalThinkDiv.innerHTML = marked.parse(thinkAccumulator.replace('<think>', ''));
            
            const finalAnswerDiv = botMessageDiv.querySelector('.answer-content-wrapper');
            if(finalAnswerDiv) finalAnswerDiv.innerHTML = marked.parse(answerAccumulator);

            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    function updateUsage(usage) {
        if (usage && usage.used !== undefined && usage.limit !== undefined) {
            usageStats.textContent = `今日用量: ${usage.used} / ${usage.limit}`;
        }
    }
});