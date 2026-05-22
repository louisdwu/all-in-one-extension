// ============================================================
// Bilibili AIO PRO (v5.0) - MAIN World Injection
// 负责：B站无登录特权全解锁（免弹窗 + 1080P画质重签 + 免登评论区 + 字幕解锁）
// ============================================================
(() => {
    'use strict';

    if (window.__bili_aio_v5) return;
    window.__bili_aio_v5 = true;

    const _setTimeout = window.setTimeout;
    const _defineProperty = Object.defineProperty;
    const _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

    // ---- 1. 配置读取 ----
    let config = {};
    try {
        const configStr = document.documentElement.getAttribute('data-aio-bili-config');
        if (configStr) config = JSON.parse(configStr);
    } catch (e) {
        console.error('[AIO Bili] Failed to parse config', e);
    }

    const syncAutoplay = () => {
        if (config.biliAutoPlay === undefined) return;
        try {
            const profileStr = localStorage.getItem('bpx_player_profile');
            let profile = {};
            if (profileStr) profile = JSON.parse(profileStr);
            
            if (!profile.media) profile.media = {};
            
            if (profile.media.autoplay !== config.biliAutoPlay) {
                console.log(`[AIO Bili] Syncing Bilibili autoplay: ${profile.media.autoplay} -> ${config.biliAutoPlay}`);
                profile.media.autoplay = config.biliAutoPlay;
                localStorage.setItem('bpx_player_profile', JSON.stringify(profile));
            }
        } catch (e) {
            console.warn('[AIO Bili] Autoplay sync failed', e);
        }
    };

    // 立即同步自动播放配置
    syncAutoplay();

    // ---- 2. 判断登录状态 ----
    // 精准识别真正的 B 站登录标识（DedeUserID__ckMd5）
    // 如果已登录，我们绝不启用拦截器，完美保护原账号体验！
    const isLogin = !!document.cookie.match(/DedeUserID__ckMd5=([^;]+)/);
    console.log(`[AIO Bili] Login status: ${isLogin ? '🟢 Logged In (No Intercept)' : '🔴 Unlogged (Activating Privilege Decoupling)'}`);

    // ---- 3. 免登录特权破解核心 (仅在未登录时激活) ----
    if (!isLogin) {
        const fakeUid = Math.floor(Math.random() * 100000000) + 100000000;

        // A. 自动注入伪造 DedeUserID Cookie
        // 很多 B 站的内部接口（如评论区、Wbi 接口等）需要非空 DedeUserID，这里写入随机临时标识
        if (!document.cookie.includes('DedeUserID=')) {
            document.cookie = `DedeUserID=${fakeUid}; path=/; domain=.bilibili.com`;
        }

        // B. MD5 算法核心 (用于前端重新计算 Wbi 签名)
        const md5 = (string) => {
            function RotateLeft(lValue, iShiftBits) {
                return (lValue<<iShiftBits) | (lValue>>>(32-iShiftBits));
            }
            function AddUnsigned(lX,lY) {
                var lX4,lY4,lX8,lY8,lResult;
                lX8 = (lX & 0x80000000);
                lY8 = (lY & 0x80000000);
                lX4 = (lX & 0x40000000);
                lY4 = (lY & 0x40000000);
                lResult = (lX & 0x3FFFFFFF)+(lY & 0x3FFFFFFF);
                if (lX4 & lY4) {
                    return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
                }
                if (lX4 | lY4) {
                    if (lResult & 0x40000000) {
                        return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                    } else {
                        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
                    }
                } else {
                    return (lResult ^ lX8 ^ lY8);
                }
            }
            function F(x,y,z) { return (x & y) | ((~x) & z); }
            function G(x,y,z) { return (x & z) | (y & (~z)); }
            function H(x,y,z) { return (x ^ y ^ z); }
            function I(x,y,z) { return (y ^ (x | (~z))); }
            function FF(a,b,c,d,x,s,ac) {
                a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b,c,d), x), ac));
                return AddUnsigned(RotateLeft(a, s), b);
            }
            function GG(a,b,c,d,x,s,ac) {
                a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b,c,d), x), ac));
                return AddUnsigned(RotateLeft(a, s), b);
            }
            function HH(a,b,c,d,x,s,ac) {
                a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b,c,d), x), ac));
                return AddUnsigned(RotateLeft(a, s), b);
            }
            function II(a,b,c,d,x,s,ac) {
                a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b,c,d), x), ac));
                return AddUnsigned(RotateLeft(a, s), b);
            }
            function ConvertToWordArray(string) {
                var lWordCount;
                var lMessageLength = string.length;
                var lNumberOfWords_temp1 = lMessageLength + 4;
                var lNumberOfWords_temp2 = (lNumberOfWords_temp1-(lNumberOfWords_temp1 % 64))/64;
                var lNumberOfWords = (lNumberOfWords_temp2+1)*16;
                var lWordArray = Array(lNumberOfWords-1);
                var lBytePosition = 0;
                var lByteCount = 0;
                while ( lBytePosition < lMessageLength ) {
                    lWordCount = (lBytePosition-(lBytePosition % 4))/4;
                    lByteCount = (lBytePosition % 4)*8;
                    lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lBytePosition)<<lByteCount));
                    lBytePosition++;
                }
                lWordCount = (lBytePosition-(lBytePosition % 4))/4;
                lByteCount = (lBytePosition % 4)*8;
                lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80<<lByteCount);
                lWordArray[lNumberOfWords-2] = lMessageLength<<3;
                lWordArray[lNumberOfWords-1] = lMessageLength>>>29;
                return lWordArray;
            }
            function WordToHex(lValue) {
                var WordToHexValue="",WordToHexValue_temp="",lByte,lCount;
                for (lCount = 0;lCount<=3;lCount++) {
                    lByte = (lValue>>>(lCount*8)) & 255;
                    WordToHexValue_temp = "0" + lByte.toString(16);
                    WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
                }
                return WordToHexValue;
            }
            function Utf8Encode(string) {
                string = string.replace(/\r\n/g,"\n");
                var utftext = "";
                for (var n = 0; n < string.length; n++) {
                    var c = string.charCodeAt(n);
                    if (c < 128) {
                        utftext += String.fromCharCode(c);
                    } else if((c > 127) && (c < 2048)) {
                        utftext += String.fromCharCode((c >>> 6) | 192);
                        utftext += String.fromCharCode((c & 63) | 128);
                    } else {
                        utftext += String.fromCharCode((c >>> 12) | 224);
                        utftext += String.fromCharCode(((c >>> 6) & 63) | 128);
                        utftext += String.fromCharCode((c & 63) | 128);
                    }
                }
                return utftext;
            }
            var x = Array();
            var k,AA,BB,CC,DD,a,b,c,d;
            var S11=7, S12=12, S13=17, S14=22;
            var S21=5, S22=9 , S23=14, S24=20;
            var S31=4, S32=11, S33=16, S34=23;
            var S41=6, S42=10, S43=15, S44=21;
            string = Utf8Encode(string);
            x = ConvertToWordArray(string);
            a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
            for (k=0;k<x.length;k+=16) {
                AA=a; BB=b; CC=c; DD=d;
                a=FF(a,b,c,d,x[k+0], S11,0xD76AA478);
                d=FF(d,a,b,c,x[k+1], S12,0xE8C7B756);
                c=FF(c,d,a,b,x[k+2], S13,0x242070DB);
                b=FF(b,c,d,a,x[k+3], S14,0xC1BDCEEE);
                a=FF(a,b,c,d,x[k+4], S11,0xF57C0FAF);
                d=FF(d,a,b,c,x[k+5], S12,0x4787C62A);
                c=FF(c,d,a,b,x[k+6], S13,0xA8304613);
                b=FF(b,c,d,a,x[k+7], S14,0xFD469501);
                a=FF(a,b,c,d,x[k+8], S11,0x698098D8);
                d=FF(d,a,b,c,x[k+9], S12,0x8B44F7AF);
                c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1);
                b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
                a=FF(a,b,c,d,x[k+12],S11,0x6B901122);
                d=FF(d,a,b,c,x[k+13],S12,0xFD987193);
                c=FF(c,d,a,b,x[k+14],S13,0xA679438E);
                b=FF(b,c,d,a,x[k+15],S14,0x49B40821);
                a=GG(a,b,c,d,x[k+1], S21,0xF61E2562);
                d=GG(d,a,b,c,x[k+6], S22,0xC040B340);
                c=GG(c,d,a,b,x[k+11],S23,0x265E5A51);
                b=GG(b,c,d,a,x[k+0], S24,0xE9B6C7AA);
                a=GG(a,b,c,d,x[k+5], S21,0xD62F105D);
                d=GG(d,a,b,c,x[k+10],S22,0x2441453);
                c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681);
                b=GG(b,c,d,a,x[k+4], S24,0xE7D3FBC8);
                a=GG(a,b,c,d,x[k+9], S21,0x21E1CDE6);
                d=GG(d,a,b,c,x[k+14],S22,0xC33707D6);
                c=GG(c,d,a,b,x[k+3], S23,0xF4D50D87);
                b=GG(b,c,d,a,x[k+8], S24,0x455A14ED);
                a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905);
                d=GG(d,a,b,c,x[k+2], S22,0xFCEFA3F8);
                c=GG(c,d,a,b,x[k+7], S23,0x676F02D9);
                b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
                a=HH(a,b,c,d,x[k+5], S31,0xFFFA3942);
                d=HH(d,a,b,c,x[k+8], S32,0x8771F681);
                c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122);
                b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
                a=HH(a,b,c,d,x[k+1], S31,0xA4BEEA44);
                d=HH(d,a,b,c,x[k+4], S32,0x4BDECFA9);
                c=HH(c,d,a,b,x[k+7], S33,0xF6BB4B60);
                b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
                a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6);
                d=HH(d,a,b,c,x[k+0], S32,0xEAA127FA);
                c=HH(c,d,a,b,x[k+3], S33,0xD4EF3085);
                b=HH(b,c,d,a,x[k+6], S34,0x4881D05);
                a=HH(a,b,c,d,x[k+9], S31,0xD9D4D039);
                d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);
                c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8);
                b=HH(b,c,d,a,x[k+2], S34,0xC4AC5665);
                a=II(a,b,c,d,x[k+0], S41,0xF4292244);
                d=II(d,a,b,c,x[k+7], S42,0x432AFF97);
                c=II(c,d,a,b,x[k+14],S43,0xAB9423A7);
                b=II(b,c,d,a,x[k+5], S44,0xFC93A039);
                a=II(a,b,c,d,x[k+12],S41,0x655B59C3);
                d=II(d,a,b,c,x[k+3], S42,0x8F0CCC92);
                c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D);
                b=II(b,c,d,a,x[k+1], S44,0x85845DD1);
                a=II(a,b,c,d,x[k+8], S41,0x6FA87E4F);
                d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);
                c=II(c,d,a,b,x[k+6], S43,0xA3014314);
                b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);
                a=II(a,b,c,d,x[k+4], S41,0xF7537E82);
                d=II(d,a,b,c,x[k+11],S42,0xBD3AF235);
                c=II(c,d,a,b,x[k+2], S43,0x2AD7D2BB);
                b=II(b,c,d,a,x[k+9], S44,0xEB86D391);
                a = AddUnsigned(a,AA);
                b = AddUnsigned(b,BB);
                c = AddUnsigned(c,CC);
                d = AddUnsigned(d,DD);
            }
            var temp = WordToHex(a)+WordToHex(b)+WordToHex(c)+WordToHex(d);
            return temp.toLowerCase();
        };

        // C. Wbi 重新签名计算模块
        const mixinKeyEncTab = [
            46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
            33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
            61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62,
            11, 36, 20, 34, 44, 52
        ];
        
        const getMixinKey = (orig) => {
            return mixinKeyEncTab.map((n) => orig[n]).join("").slice(0, 32);
        };

        const encWbi = (params, img_key, sub_key) => {
            const mixin_key = getMixinKey(img_key + sub_key);
            const curr_time = Math.round(Date.now() / 1e3);
            const chr_filter = /[!'()*]/g;
            Object.assign(params, { wts: curr_time });
            const query = Object.keys(params).sort().map((key) => {
                const value = params[key].toString().replace(chr_filter, "");
                return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            }).join("&");
            const wbi_sign = md5(query + mixin_key);
            return `${query}&w_rid=${wbi_sign}`;
        };

        const useWebKey = (key_url) => {
            if (!key_url) return '';
            return key_url.slice(key_url.lastIndexOf("/") + 1, key_url.lastIndexOf("."));
        };

        // D. 伪造已登录用户数据的精致响应对象
        const mockUserInfoResult = {
            code: 0,
            message: "0",
            ttl: 1,
            data: {
                isLogin: true,
                email_verified: 1,
                face: "https://i0.hdslb.com/bfs/face/member/noface.jpg",
                face_nft: 0,
                face_nft_type: 0,
                level_info: {
                    current_level: 6,
                    current_min: 28800,
                    current_exp: 29050,
                    next_exp: "--"
                },
                mid: fakeUid,
                mobile_verified: 1,
                money: 9999.99,
                moral: 70,
                official: { role: 0, title: "", desc: "", type: -1 },
                officialVerify: { type: -1, desc: "" },
                pendant: { pid: 0, name: "", image: "", expire: 0, image_enhance: "", image_enhance_frame: "", n_pid: 0 },
                scores: 0,
                uname: "AIO 免登用户",
                vipDueDate: 167474880000000,
                vipStatus: 1,
                vipType: 2,
                vip_pay_type: 0,
                vip_theme_type: 0,
                vip_label: {
                    path: "", text: "年度大会员", label_theme: "annual_vip", text_color: "#FFFFFF", bg_style: 1, bg_color: "#FB7299", border_color: ""
                },
                vip_avatar_subscript: 1,
                vip_nickname_color: "#FB7299",
                vip: {
                    type: 2, status: 1, due_date: 167474880000000, vip_pay_type: 0, theme_type: 0,
                    label: {
                        path: "", text: "年度大会员", label_theme: "annual_vip", text_color: "#FFFFFF", bg_style: 1, bg_color: "#FB7299", border_color: ""
                    },
                    avatar_subscript: 1, nickname_color: "#FB7299", role: 1
                },
                wallet: { mid: fakeUid, bcoin_balance: 0, coupon_balance: 0, coupon_due_time: 0 },
                has_shop: false, shop_url: "", answer_status: 0, is_senior_member: 1,
                wbi_img: {
                    // wbi url 首次运行先从真实 nav 请求拦截捕获
                    img_url: localStorage.getItem('wbi_img_url') || "https://i0.hdslb.com/bfs/wbi/6acec99d211244d3a6c0eb6216f22ed5.png",
                    sub_url: localStorage.getItem('wbi_sub_url') || "https://i0.hdslb.com/bfs/wbi/70d742617d91456ca121544a4bcf6dfa.png"
                },
                is_jury: false
            }
        };

        const mockRelationResult = {
            code: 0, message: "0", ttl: 1,
            data: {
                relation: { mid: 0, attribute: 0, mtime: 0, tag: null, special: 0 },
                be_relation: { mid: 0, attribute: 0, mtime: 0, tag: null, special: 0 }
            }
        };

        const mockArchiveRelationResult = {
            code: 0, message: "0", ttl: 1,
            data: { attention: false, favorite: false, season_fav: false, like: false, dislike: false, coin: 0 }
        };

        const needsPatch = (u) => {
            if (!u) return false;
            return u.includes('/x/web-interface/nav') || 
                   u.includes('/x/player/wbi/v2') || 
                   u.includes('/x/v2/reply') || 
                   u.includes('/x/web-interface/relation') || 
                   u.includes('/x/web-interface/archive/relation') ||
                   u.includes('/x/space/v2/myinfo');
        };

        // E. 核心响应劫持器
        const patchJSON = (text, url) => {
            try {
                const json = JSON.parse(text);
                if (!json) return text;

                // 1. 个人信息 nav 劫持与真实的 Wbi 密钥捕获
                if (url.includes('/x/web-interface/nav')) {
                    if (json.data) {
                        // 拦截并提取真正的 wbi_img url 缓存到本地，用于画质重签名
                        if (json.data.wbi_img) {
                            if (json.data.wbi_img.img_url) localStorage.setItem('wbi_img_url', json.data.wbi_img.img_url);
                            if (json.data.wbi_img.sub_url) localStorage.setItem('wbi_sub_url', json.data.wbi_img.sub_url);
                        }
                        // 极度关键：若原本就是已登录，我们绝不拦截返回，直接打回
                        if (json.data.isLogin) {
                            return text;
                        }
                    }
                    return JSON.stringify(mockUserInfoResult);
                }

                // 2. 播放器配置劫持 (用于解锁 AI 字幕)
                if (url.includes('/x/player/wbi/v2') && config.biliAISubtitleEnabled !== false) {
                    if (json.data) {
                        json.data.need_login_subtitle = false;
                        if (json.data.level_info) json.data.level_info.current_level = 6;
                    }
                    return JSON.stringify(json);
                }

                // 3. 评论区劫持 (去除评论区 code 错误)
                if (url.includes('/x/v2/reply') && config.biliCommentsEnabled !== false) {
                    if (json.code !== 0) json.code = 0;
                    return JSON.stringify(json);
                }

                // 4. 关系状态劫持
                if (url.includes('/x/web-interface/relation')) {
                    return JSON.stringify(mockRelationResult);
                }
                if (url.includes('/x/web-interface/archive/relation')) {
                    return JSON.stringify(mockArchiveRelationResult);
                }

                // 5. 空间空间信息劫持
                if (url.includes('/x/space/v2/myinfo')) {
                    if (json.code !== 0) json.code = 0;
                    if (json.data) {
                        json.data.mid = fakeUid;
                        json.data.name = "AIO 免登用户";
                    }
                    return JSON.stringify(json);
                }
            } catch (e) {}
            return text;
        };

        // F. XHR (XMLHttpRequest) 拦截器
        const rawOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            this._aio_url = typeof url === 'string' ? url : '';
            
            // XHR 请求篡改
            if (this._aio_url.includes('/x/v2/reply/wbi/main') || this._aio_url.includes('/x/v2/reply/reply')) {
                try {
                    this.withCredentials = false; // 降级 credentials
                } catch(e) {}
            }

            // Playurl XHR 画质重签 1080P
            if (this._aio_url.includes('api.bilibili.com/x/player/wbi/playurl') && config.bili1080PEnabled !== false) {
                try {
                    const urlObj = new URL(this._aio_url.startsWith('http') ? this._aio_url : 'https:' + this._aio_url);
                    const qsParams = Object.fromEntries(urlObj.searchParams.entries());
                    qsParams.qn = '80'; // 1080P
                    qsParams.try_look = '1';

                    const imgKeyUrl = localStorage.getItem('wbi_img_url') || '';
                    const subKeyUrl = localStorage.getItem('wbi_sub_url') || '';
                    const imgKey = useWebKey(imgKeyUrl);
                    const subKey = useWebKey(subKeyUrl);

                    if (imgKey && subKey) {
                        delete qsParams.w_rid;
                        delete qsParams.wts;
                        const query = encWbi(qsParams, imgKey, subKey);
                        const newUrl = `${urlObj.origin}${urlObj.pathname}?${query}`;
                        arguments[1] = newUrl;
                        this._aio_url = newUrl;
                    }
                } catch (e) {
                    console.warn('[AIO XHR] Playurl rewrite failed', e);
                }
            }

            return rawOpen.apply(this, arguments);
        };

        const xhrRTD = _getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
        if (xhrRTD && xhrRTD.get) {
            _defineProperty(XMLHttpRequest.prototype, 'responseText', {
                get: function() {
                    const t = xhrRTD.get.call(this);
                    return needsPatch(this._aio_url) ? patchJSON(t, this._aio_url) : t;
                },
                configurable: true, enumerable: true
            });
        }

        // G. Fetch 拦截器
        const rawFetch = window.fetch;
        window.fetch = async (...args) => {
            let url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            let init = args[1] || {};

            // 拦截评论区 Fetch 请求：将 credentials 置为 omit 以避开 B 站对空 Cookie 的校验错误，实现全评论区加载
            if (url.includes('/x/v2/reply/wbi/main') || url.includes('/x/v2/reply/reply')) {
                init.credentials = 'omit';
                args[1] = init;
            }

            // 拦截视频 playurl Fetch 请求：强行解锁 1080P (qn=80) 并在前端通过 Wbi 重新计算签名，绕过校验报错
            if (url.includes('api.bilibili.com/x/player/wbi/playurl') && config.bili1080PEnabled !== false) {
                try {
                    const urlObj = new URL(url.startsWith('http') ? url : 'https:' + url);
                    const qsParams = Object.fromEntries(urlObj.searchParams.entries());
                    qsParams.qn = '80';
                    qsParams.try_look = '1';
                    
                    const imgKeyUrl = localStorage.getItem('wbi_img_url') || '';
                    const subKeyUrl = localStorage.getItem('wbi_sub_url') || '';
                    const imgKey = useWebKey(imgKeyUrl);
                    const subKey = useWebKey(subKeyUrl);

                    if (imgKey && subKey) {
                        delete qsParams.w_rid;
                        delete qsParams.wts;
                        const query = encWbi(qsParams, imgKey, subKey);
                        url = `${urlObj.origin}${urlObj.pathname}?${query}`;
                        if (typeof args[0] === 'string') {
                            args[0] = url;
                        } else if (args[0] && typeof args[0] === 'object') {
                            args[0] = new Request(url, args[0]);
                        }
                    }
                } catch (e) {
                    console.warn('[AIO Fetch] Playurl rewrite failed', e);
                }
            }

            // 拦截 Fetch 响应打补丁
            if (needsPatch(url)) {
                const resp = await rawFetch(...args);
                const text = await resp.text();
                return new Response(patchJSON(text, url), {
                    status: resp.status, statusText: resp.statusText, headers: resp.headers
                });
            }
            return rawFetch(...args);
        };

        // H. 属性覆盖 (1080P/会员锁定)
        if (config.bili1080PEnabled !== false) {
            Object.defineProperty = function(obj, prop, desc) {
                if (prop === 'isViewToday' || prop === 'isVideoAble') {
                    desc = { get: () => true, enumerable: false, configurable: true };
                }
                return _defineProperty.call(this, obj, prop, desc);
            };
        }

        // I. 登录弹窗极致延迟 (阻止弹窗)
        window.setTimeout = function(func, delay) {
            if (typeof delay === 'number' && delay >= 25000 && delay <= 35000) arguments[1] = 3e8; // 极大延迟登录弹窗
            return _setTimeout.apply(this, arguments);
        };

        // J. 额外 CSS 弹窗与广告屏蔽
        const style = document.createElement('style');
        style.textContent = `
            .bpx-player-ctrl-subtitle { display: flex !important; visibility: visible !important; }
            .bpx-player-toast-login, .bpx-player-toast-wrap .bpx-player-toast-item,
            .video-unlogin-popover, .login-panel-popover,
            .bili-mini-mask, .bili-mini-login-wrapper, .bili-mini-login,
            .vip-login-tip, .unlogin-popover { display: none !important; }
            .login-tip, [class*="login-tip"], [class*="unlogin-jump"] { display: none !important; }
            .reply-notice { display: none !important; }
        `;
        document.documentElement.appendChild(style);

        // K. 观察者自动移除垃圾内容
        const cleanWalls = () => {
            if (config.biliCommentsEnabled !== false) {
                document.querySelectorAll('.reply-notice, .comment-login-tip, .reply-login-tip, .login-tip, [class*="not-login"], [class*="unlogin"]').forEach(el => el.remove());
            }
            document.querySelectorAll('.bpx-player-toast-item, .bili-toast').forEach(el => {
                if (el.textContent && el.textContent.includes('未登录')) el.remove();
            });
        };
        const obs = new MutationObserver(cleanWalls);
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setInterval(cleanWalls, 2000);
    }

    // ---- 4. 播放控制与画质强同步 (全模式通用) ----
    let manualPaused = false, lastUI = 0;
    document.addEventListener('mousedown', (e) => {
        const t = e.target;
        if (t && (t.closest('.bpx-player-ctrl-play') || t.closest('.bpx-player-video-area') || t.closest('video'))) lastUI = Date.now();
    }, true);
    document.addEventListener('keydown', (e) => { if (['Space', 'KeyK'].includes(e.code)) lastUI = Date.now(); }, true);

    const hookVideo = (v) => {
        if (v.__aio_hooked) return;
        v.__aio_hooked = true;
        v.addEventListener('pause', () => { if (Date.now() - lastUI < 500) manualPaused = true; });
        v.addEventListener('play', () => { if (Date.now() - lastUI < 500) manualPaused = false; });
    };

    const switchTo1080P = () => {
        if (config.bili1080PEnabled === false) return;
        try {
            const p = window.player;
            if (!p || typeof p.requestQuality !== 'function') return;
            const s = p.getSupportedQualityList?.() || [];
            const c = p.getQuality?.();
            const q = c?.nowQ || c?.quality || 0;
            if (s.includes(80) && q < 80) p.requestQuality(80);
        } catch (e) {}
    };

    const mainLoop = () => {
        const v = document.querySelector('video');
        if (v) hookVideo(v);

        // 如果未登录且开启了自动播放且处于非活动暂停态
        if (!isLogin && config.biliAutoPlay && v && v.paused && !v.ended && !manualPaused && v.readyState >= 2) {
            // 防打断：如果是因为弹窗导致的暂停，强行起播
            if (Date.now() - lastUI > 2000) {
                v.play().catch(() => {});
                _setTimeout(switchTo1080P, 1000);
            }
        }
        
        if (!isLogin) {
            const btn = document.querySelector('.bpx-player-toast-confirm-login');
            if (btn) { btn.click(); _setTimeout(switchTo1080P, 2000); }
            switchTo1080P();
        }
    };

    setInterval(mainLoop, 1500);
})();
