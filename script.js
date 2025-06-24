document.addEventListener('DOMContentLoaded', async () => {
    // --- Global State ---
    let suggestions = [];
    let sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // --- Autocomplete Data Loading ---
    try {
        const response = await fetch('_data/enrollment_data_2025.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        Object.values(data.data).forEach(province => {
            Object.values(province).forEach(stream => {
                Object.keys(stream).forEach(school => {
                    suggestions.push(school);
                    Object.keys(stream[school]).forEach(major => {
                        suggestions.push(`${school} ${major}`);
                    });
                });
            });
        });
        suggestions = [...new Set(suggestions)];
    } catch (error) {
        console.error("Failed to load autocomplete suggestions:", error);
    }

    // --- Element Cache ---
    const submitButton = document.getElementById('submit-button');
    const reportContainer = document.getElementById('report-container');
    const submissionArea = document.querySelector('.submission-area');
    const submissionHeader = document.getElementById('submission-header');
    const rankInput = document.getElementById('rank-input');
    const rankSlider = document.getElementById('rank-slider');
    const rankSliderValue = document.getElementById('rank-slider-value');
    const scoreTypeGroup = document.getElementById('score-type-group');
    const usageStats = document.getElementById('usage-stats');
    const dilemmaInput = document.getElementById('dilemma-input');
    const dilemmaTags = document.querySelector('.dilemma-tags');
    const savePdfBtn = document.getElementById('save-pdf-btn');
    const invitationCodeInput = document.getElementById('invitation-code'); // Assuming you have this input

    // --- Initial State ---
    fetchInitialUsage();
    setupCollapsibleSections();

    // --- Event Listeners ---
    submitButton.addEventListener('click', () => window.handleSubmit());
    
    const mainStreamGroup = document.getElementById('main-stream-group');
    const newGaokaoOptions = document.getElementById('new-gaokao-options');
    
    mainStreamGroup.addEventListener('change', (e) => {
        newGaokaoOptions.style.display = e.target.value === '新高考' ? 'block' : 'none';
    });

    const secondChoiceGroup = document.getElementById('second-choice-group');
    secondChoiceGroup.addEventListener('change', (e) => {
        if (secondChoiceGroup.querySelectorAll('input[type="checkbox"]:checked').length > 2) {
            alert('再选科目最多只能选择两项。');
            e.target.checked = false;
        }
    });

    if (rankInput && rankSlider && rankSliderValue) {
        rankSlider.addEventListener('input', (e) => {
            rankInput.value = e.target.value;
            rankSliderValue.textContent = e.target.value;
        });
        rankInput.addEventListener('input', (e) => {
            const value = e.target.value;
            if (value && parseInt(value) <= parseInt(rankSlider.max) && parseInt(value) >= parseInt(rankSlider.min)) {
               rankSlider.value = value;
               rankSliderValue.textContent = value;
            }
        });
    }

    if (scoreTypeGroup) {
        scoreTypeGroup.addEventListener('change', (e) => {
            const type = e.target.value;
            const isScore = type === 'score';
            rankInput.placeholder = isScore ? "例如: 650" : "例如: 12000";
            rankSlider.min = isScore ? 150 : 1;
            rankSlider.max = isScore ? 750 : 750000;
            rankSlider.step = isScore ? 1 : 100;
            const defaultValue = isScore ? 500 : 100000;
            rankSlider.value = defaultValue;
            rankSliderValue.textContent = defaultValue;
            rankInput.value = defaultValue;
        });
    }

    if (dilemmaTags) {
        dilemmaTags.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-btn')) {
                dilemmaInput.value += (dilemmaInput.value ? '，' : '') + e.target.textContent;
            }
        });
    }

    if(savePdfBtn) {
        savePdfBtn.addEventListener('click', handleSavePdf);
    }

    // --- Autocomplete Initialization ---
    if (suggestions.length > 0) {
        new autoComplete({
            selector: '#options-input',
            minChars: 1,
            source: function(term, suggest){
                term = term.toLowerCase();
                const matches = suggestions.filter(choice => choice.toLowerCase().includes(term));
                suggest(matches);
            }
        });
    }

    // --- Collapsible Sections Logic ---
    function setupCollapsibleSections() {
        const isMobile = () => window.innerWidth <= 1024;
        let firstSubmit = true;

        if (!isMobile()) return;

        submissionArea.classList.remove('collapsed');
        updateCollapseIcons();

        submissionHeader.addEventListener('click', () => {
            submissionArea.classList.toggle('collapsed');
            updateCollapseIcons();
        });
        
        function updateCollapseIcons() {
            const subIcon = submissionHeader.querySelector('.collapse-icon');
            subIcon.className = submissionArea.classList.contains('collapsed')
                ? 'fas fa-chevron-down collapse-icon'
                : 'fas fa-chevron-up collapse-icon';
        }

        window.originalHandleSubmit = handleSubmit;
        window.handleSubmit = async function() {
            if (isMobile() && firstSubmit) {
                submissionArea.classList.add('collapsed');
                updateCollapseIcons();
                firstSubmit = false;
            }
            await window.originalHandleSubmit.apply(this, arguments);
        }
    }

    // --- Main Handler Functions ---
    async function handleSubmit() {
        const userInput = await getUserInput();
        if (!userInput) return; // Validation failed in getUserInput

        const invitationCode = invitationCodeInput.value.trim();
        if (!invitationCode) {
            alert("请输入邀请码。");
            return;
        }

        const botMessageDiv = createBotMessage();
        const { thinkContainer, thinkContent, answerContent } = botMessageDiv;
        
        submitButton.disabled = true;
        savePdfBtn.style.display = 'none';
        answerContent.innerHTML = '<div class="typing-cursor"></div>';

        let isThinking = true;
        let fullResponse = "";

        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    userInput,
                    sessionId,
                    invitationCode
                })
            });

            if (response.headers.get("Content-Type")?.includes("application/json")) {
                const errorData = await response.json();
                if (errorData.usage) updateUsage(errorData.usage);
                answerContent.innerHTML = `<pre style="color:red;">${errorData.error}</pre>`;
                submitButton.disabled = false;
                return;
            }

            if (!response.ok || !response.body) {
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
                        try {
                            const token = JSON.parse(data);
                            fullResponse += token;

                            // Real-time rendering logic
                            if (isThinking) {
                                if (fullResponse.includes('</think>')) {
                                    isThinking = false;
                                    const thinkPart = fullResponse.match(/<think>([\s\S]*)<\/think>/)[1];
                                    const answerPart = fullResponse.substring(fullResponse.indexOf('</think>') + 8);
                                    thinkContent.innerHTML = marked.parse(thinkPart);
                                    answerContent.innerHTML = marked.parse(answerPart);
                                } else {
                                    const thinkPart = fullResponse.replace('<think>', '');
                                    thinkContent.innerHTML = marked.parse(thinkPart) + '<span class="typing-cursor"></span>';
                                    thinkContainer.style.display = 'block';
                                }
                            } else {
                                const answerPart = fullResponse.substring(fullResponse.indexOf('</think>') + 8);
                                answerContent.innerHTML = marked.parse(answerPart) + '<span class="typing-cursor"></span>';
                            }
                            reportContainer.scrollTop = reportContainer.scrollHeight;

                        } catch (e) { console.error("Failed to parse token:", data); }
                    } else if (message.startsWith('event: usage')) {
                        const data = message.substring(message.indexOf('data: ') + 6);
                        try {
                            updateUsage(JSON.parse(data));
                        } catch (e) { console.error("Failed to parse usage data:", data); }
                    } else if (message.startsWith('event: end')) {
                        // Final cleanup
                        answerContent.querySelector('.typing-cursor')?.remove();
                        thinkContent.querySelector('.typing-cursor')?.remove();
                        savePdfBtn.style.display = 'inline-block';
                        submitButton.disabled = false;
                        return; 
                    } else if (message.startsWith('event: error')) {
                        const data = message.substring(message.indexOf('data: ') + 6);
                        try {
                            const errorData = JSON.parse(data);
                            answerContent.innerHTML = `<pre style="color:red;">${JSON.stringify(errorData, null, 2)}</pre>`;
                        } catch(e) {
                            answerContent.innerHTML = `<pre style="color:red;">${data}</pre>`;
                        }
                        submitButton.disabled = false;
                        return; 
                    }
                    boundary = buffer.indexOf('\n\n');
                }
            }

        } catch(error) {
            console.error("Submit/Fetch Error:", error);
            answerContent.innerHTML = `<pre style="color:red;">网络请求失败: ${error.message}</pre>`;
        } finally {
            submitButton.disabled = false;
            answerContent.querySelector('.typing-cursor')?.remove();
            thinkContent.querySelector('.typing-cursor')?.remove();
        }
    }

    function createBotMessage() {
        const botMessageDiv = document.createElement('div');
        botMessageDiv.className = 'bot-message';
        const thinkContainer = document.createElement('div');
        thinkContainer.className = 'think-container';
        thinkContainer.style.display = 'none';
        const toggleThink = document.createElement('div');
        toggleThink.className = 'toggle-think';
        toggleThink.innerHTML = '展开AI思考过程 <i class="fas fa-chevron-down"></i>';
        const thinkContent = document.createElement('div');
        thinkContent.className = 'think-content markdown-content';
        thinkContainer.appendChild(toggleThink);
        thinkContainer.appendChild(thinkContent);
        const answerContent = document.createElement('div');
        answerContent.className = 'answer-content markdown-content';
        botMessageDiv.appendChild(thinkContainer);
        botMessageDiv.appendChild(answerContent);
        reportContainer.appendChild(botMessageDiv);
        reportContainer.scrollTop = reportContainer.scrollHeight;
        toggleThink.addEventListener('click', () => {
            thinkContent.classList.toggle('expanded');
            toggleThink.classList.toggle('expanded');
            toggleThink.innerHTML = thinkContent.classList.contains('expanded') 
                ? '收起AI思考过程 <i class="fas fa-chevron-down"></i>'
                : '展开AI思考过程 <i class="fas fa-chevron-down"></i>';
        });
        return { thinkContainer, thinkContent, answerContent };
    }

    function updateUsage(usage) {
        if (usage && usage.used !== undefined && usage.limit !== undefined) {
            usageStats.textContent = `今日用量: ${usage.used} / ${usage.limit}`;
        }
    }

    async function fetchInitialUsage() {
        try {
            const response = await fetch('/api/usage');
            if (response.ok) {
                const data = await response.json();
                updateUsage(data);
                if (data.used >= data.limit) {
                    alert("非常抱歉，今日的免费体验名额已被抢完！请您明日再来。");
                    if(submitButton) submitButton.disabled = true;
                }
            }
        } catch (error) {
            console.error("Failed to fetch initial usage:", error);
            usageStats.textContent = "用量: N/A";
        }
    }

    async function handleSavePdf() {
        const reportToSave = reportContainer.querySelector('.bot-message:last-child');
        if (!reportToSave) {
            alert("没有可保存的报告。");
            return;
        }
        
        savePdfBtn.disabled = true;
        savePdfBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在生成...';

        try {
            const { jsPDF } = window.jspdf;
            const userInput = await getUserInput();
            
            const pdfContent = document.createElement('div');
            pdfContent.style.padding = '20px';
            pdfContent.style.width = '800px';
            pdfContent.style.background = 'white';
            
            const userInputHeader = document.createElement('h3');
            userInputHeader.textContent = '我的输入';
            pdfContent.appendChild(userInputHeader);
            
            const userInputContent = document.createElement('pre');
            userInputContent.style.whiteSpace = 'pre-wrap';
            userInputContent.style.fontFamily = 'inherit';
            userInputContent.textContent = userInput.rawText;
            pdfContent.appendChild(userInputContent);

            const reportHeader = document.createElement('h3');
            reportHeader.textContent = 'AI分析报告';
            reportHeader.style.marginTop = '20px';
            pdfContent.appendChild(reportHeader);

            const answerClone = reportToSave.querySelector('.answer-content').cloneNode(true);
            pdfContent.appendChild(answerClone);

            pdfContent.style.position = 'absolute';
            pdfContent.style.left = '-9999px';
            pdfContent.style.top = '0px';
            document.body.appendChild(pdfContent);

            const canvas = await html2canvas(pdfContent, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff'
            });
            
            document.body.removeChild(pdfContent);

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'p',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });
            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save("高考志愿AI分析报告.pdf");
        } catch (error) {
            console.error("Failed to save PDF:", error);
            alert("保存PDF失败，请检查控制台错误信息。");
        } finally {
            savePdfBtn.disabled = false;
            savePdfBtn.innerHTML = '<i class="fas fa-file-pdf"></i> 保存为PDF';
        }
    }

    async function getUserInput() {
        const province = document.getElementById('province-select').value;
        const selectedStream = document.querySelector('input[name="stream"]:checked').value;
        const rank = document.getElementById('rank-input').value;
        const options = document.getElementById('options-input').value;
        const dilemma = document.getElementById('dilemma-input').value;
        const scoreType = document.querySelector('input[name="score_type"]:checked').value;
        const scoreLabel = scoreType === 'score' ? '分数' : '位次';

        let streamText = selectedStream;
        if (selectedStream === '新高考') {
            const firstChoice = document.querySelector('input[name="first-choice"]:checked')?.value;
            const secondChoices = Array.from(document.querySelectorAll('input[name="second-choice"]:checked')).map(cb => cb.value);
            
            if (!firstChoice || secondChoices.length !== 2) {
                alert('请完成新高考的选科（1门首选+2门再选）。');
                return null;
            }
            streamText = `新高考 (3+1+2): ${firstChoice} + ${secondChoices.join(' + ')}`;
        }
        
        const rawText = `
省份: ${province}
科类: ${streamText}
${scoreLabel}: ${rank}
纠结的方案:
${options}
我的主要困惑:
${dilemma}
        `.trim();

        return {
            province: province,
            stream: streamText,
            rank: rank ? parseInt(rank, 10) : null,
            rawText: rawText,
        };
    }

    window.handleSubmit = handleSubmit;
});