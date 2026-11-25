/* Text-only helpers for ModelDesk's home title and short greetings in chat. */
(() => {
    'use strict';

    function home(source) {
        if (typeof source !== 'string') return null;
        const text = source.trim();
        if (text === 'Hey there, what should we build today?') return '你好，今天我们来做点什么？';
        if (text === 'Welcome back. Where should we pick up?') return '欢迎回来。我们从哪里继续？';
        if (text === "Good to see you. What's next?") return '很高兴见到你。接下来做什么？';
        let named = /^Hey (.+), what should we build today\?$/.exec(text);
        if (named) return `你好，${named[1]}！今天我们来做点什么？`;
        named = /^Welcome back, (.+)\. Where should we pick up\?$/.exec(text);
        if (named) return `欢迎回来，${named[1]}！我们从哪里继续？`;
        named = /^Good to see you, (.+)\. What's next\?$/.exec(text);
        return named ? `很高兴见到你，${named[1]}！接下来做什么？` : null;
    }

    const greetings = new Map([
        ['hi', '你好'], ['hello', '你好'], ['hey', '你好'],
        ['hi there', '你好'], ['hello there', '你好'], ['hey there', '你好'],
        ['hello everyone', '大家好'], ['hi everyone', '大家好'],
        ['good morning', '早上好'], ['good afternoon', '下午好'],
        ['good evening', '晚上好'], ['good night', '晚安'],
        ['welcome back', '欢迎回来'], ['nice to meet you', '很高兴认识你'],
        ['good to see you', '很高兴见到你'], ['long time no see', '好久不见'],
    ]);

    const offers = new Map([
        ['how can i help you today', '今天有什么可以帮你的吗？'],
        ['how can i help today', '今天有什么可以帮你的吗？'],
        ['how can i help you', '有什么可以帮你的吗？'],
        ['how can i help', '有什么可以帮你的吗？'],
        ['how may i help you', '有什么可以帮你的吗？'],
        ['how can i assist you today', '今天有什么可以帮你的吗？'],
        ['how may i assist you today', '今天有什么可以帮你的吗？'],
        ['how can i assist you', '有什么可以帮你的吗？'],
        ['what can i help you with today', '今天有什么可以帮你的吗？'],
        ['what would you like to work on today', '你今天想做点什么？'],
        ['what can i do for you today', '今天需要我帮你做什么？'],
        ['how are you', '你好吗？'],
        ['how are you today', '你今天过得怎么样？'],
    ]);

    // Only match an entire, short, plain-text greeting. Leave prose and code
    // to the regular conversation translator.
    function chat(source) {
        if (typeof source !== 'string' || source.length > 120) return null;
        const text = source.trim().toLowerCase();
        const bare = text.match(/^([a-z ]+)([.!,?]?)$/);
        if (bare) {
            const [, words, mark] = bare;
            if (greetings.has(words)) {
                const punctuation = { '': '', '.': '。', '!': '！', '?': '？', ',': '，' };
                return greetings.get(words) + punctuation[mark];
            }
            if (offers.has(words)) return offers.get(words);
        }
        const combined = text.match(/^([a-z ]+)[!.,] +([a-z ]+)\??$/);
        if (combined && greetings.has(combined[1]) && offers.has(combined[2])) {
            return greetings.get(combined[1]) + '！' + offers.get(combined[2]);
        }
        return null;
    }

    globalThis.ModelDeskChineseGreeting = Object.freeze({home, chat});
})();
