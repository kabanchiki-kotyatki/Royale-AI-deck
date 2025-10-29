// ==UserScript==
// @name         RoyaleAPI — Auto cards then last 40 battles -> copy final template with Copy button
// @namespace    https://royaleapi.com/
// @version      2.2
// @description  Collect player cards and recent battles, then provide a "Copy" button to copy final template to clipboard (Safari-friendly). Minimal comments in English.
// @author       Merged by assistant
// @match        https://royaleapi.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Config
    const PLAYER_TAG = '20YL2902LV';
    const BASE = location.origin || 'https://royaleapi.com';
    const CARDS_PATH = `/player/${PLAYER_TAG}/cards/levels`;
    const BATTLES_PATH = `/player/${PLAYER_TAG}/battles`;
    const CARDS_URL = BASE + CARDS_PATH;
    const BATTLES_URL = BASE + BATTLES_PATH;

    // New: minimal card level to record (default 10). Cards below this level will NOT be recorded.
    const MIN_CARD_LEVEL = 10;

    // Keys
    const KEY_CARDS_TEXT = 'r_merged_cards_v1';
    const KEY_BATTLES_DATA = 'r_copy_battles_data_v3';
    const KEY_RESUME_META = 'r_copy_battles_resume_v3';
    const KEY_AUTOFLOW_STAGE = 'r_autoflow_stage_v1';
    const KEY_FINAL_TEXT = 'r_copy_final_text_v1';

    const MAX_BATTLES_TO_KEEP = 30;

    // Utils
    function log(...a) { console.log('[RA-AUTO]', ...a); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function safeText(el) { return el ? String(el.textContent || '').trim().replace(/\s+/g, ' ') : ''; }

    async function copyToClipboardSafariSafe(text) {
        if (!text) return Promise.reject(new Error('Empty text'));
        // Prefer modern API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try { await navigator.clipboard.writeText(text); return; } catch (e) { /* fallback */ }
        }
        // Fallback using textarea + execCommand (works in many Safari versions)
        return new Promise((resolve, reject) => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                // Place off-screen
                ta.style.position = 'fixed';
                ta.style.left = '-99999px';
                ta.style.top = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) resolve();
                else reject(new Error('execCommand copy failed'));
            } catch (err) {
                reject(err);
            }
        });
    }

    function sessionSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function sessionGet(k) { try { const r = sessionStorage.getItem(k); if (!r) return null; return JSON.parse(r); } catch (e) { return null; } }
    function sessionRemove(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

    // Auto-start from root -> cards page
    (async function initialRedirectIfRoot() {
        const path = location.pathname.replace(/\/+$/, '') || '/';
        if ((path === '/' || path === '') && location.hostname === 'royaleapi.com') {
            sessionSet(KEY_AUTOFLOW_STAGE, 'start');
            sessionRemove(KEY_BATTLES_DATA);
            sessionRemove(KEY_RESUME_META);
            sessionRemove(KEY_CARDS_TEXT);
            sessionRemove(KEY_FINAL_TEXT);
            location.href = CARDS_URL;
        }
    })();

    // Minimal card collection
    async function waitForCardsOnPage(timeout = 15000) {
        const selector = '.player_card_link.player_card_item, .player_card_item, a.player_card_link';
        const start = Date.now();
        let nodes = Array.from(document.querySelectorAll(selector)).filter(n => n.offsetParent !== null);
        if (nodes.length) return nodes;
        return new Promise((resolve) => {
            let resolved = false;
            const obs = new MutationObserver(() => {
                if (resolved) return;
                nodes = Array.from(document.querySelectorAll(selector)).filter(n => n.offsetParent !== null);
                if (nodes.length) { resolved = true; obs.disconnect(); resolve(nodes); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            const int = setInterval(() => {
                if (resolved) { clearInterval(int); return; }
                nodes = Array.from(document.querySelectorAll(selector)).filter(n => n.offsetParent !== null);
                if (nodes.length) { resolved = true; clearInterval(int); obs.disconnect(); resolve(nodes); }
                if (Date.now() - start > timeout) { resolved = true; clearInterval(int); obs.disconnect(); resolve(Array.from(document.querySelectorAll(selector))); }
            }, 300);
        });
    }

    async function collectCardsOnPage() {
        const nodes = await waitForCardsOnPage(15000);
        if (!nodes || !nodes.length) return '';
        const lines = [];
        for (const a of nodes) {
            try {
                const nameEl = a.querySelector('.player_cards__card_name') || a.querySelector('.card_name') || a.querySelector('.name') || a.querySelector('img');
                const name = (nameEl && safeText(nameEl)) || (a.querySelector('img')?.alt || '').trim() || 'Unknown';
                const levelText = (a.querySelector('.player_cards__card_level')?.innerText || a.querySelector('.card-level')?.innerText || '').trim();
                const level = (levelText.match(/\d+/) || [''])[0] || '';
                const levelNum = parseInt(level, 10) || 0;
                // Skip cards below MIN_CARD_LEVEL
                if (levelNum < MIN_CARD_LEVEL) continue;
                const elixir = a.getAttribute('data-elixir') || (a.querySelector('.player_cards__crelixir')?.innerText || a.querySelector('.elixir')?.innerText || '').trim();
                const id = a.id || (a.getAttribute('href') || '');
                let evolution = '';
                const evMatch = (id || '').match(/-ev\d+/i);
                if (evMatch) evolution = evMatch[0].replace(/^-/, '');
                let line = `${name} — Lvl ${levelNum || 'n/a'} — Elixir: ${elixir || 'n/a'}`;
                if (evolution) line += ` — Evolution: ${evolution}`;
                lines.push(line);
            } catch (e) { /* ignore */ }
        }
        return lines.join('\n');
    }

    (async function autoCollectCardsIfOnCardsPage() {
        const path = location.pathname.replace(/\/+$/, '');
        if (path === CARDS_PATH) {
            await sleep(300);
            const stage = sessionGet(KEY_AUTOFLOW_STAGE);
            const cardsSaved = sessionGet(KEY_CARDS_TEXT);
            if (stage === 'start' || !cardsSaved) {
                try {
                    const text = await collectCardsOnPage();
                    sessionSet(KEY_CARDS_TEXT, text || '');
                    sessionSet(KEY_AUTOFLOW_STAGE, 'cards_collected');
                    await sleep(300);
                    location.href = BATTLES_URL;
                } catch (e) { console.error(e); }
            } else {
                if (location.pathname !== BATTLES_PATH) { await sleep(200); location.href = BATTLES_URL; }
            }
        }
    })();

    // Battles collection utilities
    const SCROLL_STEP = 800;
    const SCROLL_DELAY = 250;
    const STABLE_POLL_MS = 300;
    const STABLE_REQUIRED_MS = 900;
    const STABLE_MAX_WAIT = 8000;
    const LOADER_SELECTOR = '#scrolling_battle_loader, .scrolling_battle_loader';
    const LOADER_POLL_MS = 300;
    const LOADER_MAX_WAIT = 8000;

    function getBattleCount() { return document.querySelectorAll('.battle_list_battle, .battle.battle_list_battle, [id^="battle_"]').length; }

    function parseTimeToNumber(raw) {
        if (!raw) return Date.now();
        const s = String(raw).trim();
        let cleaned = s.replace(/\s*UTC\s*$/i, '').trim();
        if (/^\d+(\.\d+)?$/.test(cleaned)) {
            const num = parseFloat(cleaned);
            if (String(Math.floor(num)).length < 12) return Math.floor(num * 1000);
            return Math.floor(num);
        }
        try { let d = new Date(cleaned); if (!isNaN(d)) return d.getTime(); } catch (e) {}
        return Date.now();
    }

    function cleanStatRaw(str) {
        if (!str) return '';
        let t = String(str).trim();
        t = t.replace(/\b(Avg Elixir|Average Elixir|4-Card Cycle|4 Card Cycle|Elixir Leaked|Elixir leaked)\b[:\s-]*/ig, '').trim();
        const m = t.match(/-?\d+(\.\d+)?/);
        if (m) {
            const num = parseFloat(m[0]);
            if (Number.isInteger(num)) return String(num);
            return String(+num.toFixed(2));
        }
        return t.replace(/\s{2,}/g,' ').trim();
    }

    function collectBattlesFromDOM() {
        const battleEls = Array.from(document.querySelectorAll('.battle_list_battle, .battle.battle_list_battle, [id^="battle_"]'));
        const parsed = [];
        for (const b of battleEls) {
            try {
                const pb = formatBattle(b);
                if (pb && (pb.id || pb.timeNum) && pb.text) parsed.push(pb);
            } catch (e) { /* ignore */ }
        }
        return parsed;
    }

    function isElementVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        if (rect.bottom < 0 || rect.top > vh) return false;
        if (rect.right < 0 || rect.left > vw) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
        return true;
    }

    async function waitForLoaderGone(timeout = LOADER_MAX_WAIT) {
        const start = Date.now();
        return new Promise(resolve => {
            const check = () => {
                const loader = document.querySelector(LOADER_SELECTOR);
                const visible = loader && isElementVisible(loader);
                if (!visible) { resolve(true); return; }
                if (Date.now() - start >= timeout) { resolve(false); return; }
                setTimeout(check, LOADER_POLL_MS);
            };
            check();
        });
    }

    async function autoScrollToBottomRespectLoader() {
        const maxTotal = 20000;
        const start = Date.now();
        while (true) {
            const bodyHeight = document.body.scrollHeight;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            const targetY = Math.max(0, bodyHeight - viewportHeight);
            if (window.scrollY >= targetY - 10) {
                const loaderNow = document.querySelector(LOADER_SELECTOR);
                if (loaderNow && isElementVisible(loaderNow)) {
                    const rect = loaderNow.getBoundingClientRect();
                    const scrollToY = Math.max(0, window.scrollY + rect.top - Math.floor(viewportHeight * 0.7));
                    window.scrollTo({ top: scrollToY, behavior: 'smooth' });
                    await sleep(350);
                    const loaderGone = await waitForLoaderGone(LOADER_MAX_WAIT);
                    if (!loaderGone) return;
                    else { await sleep(200); continue; }
                }
                window.scrollTo({ top: targetY, behavior: 'smooth' });
                await sleep(350);
                return;
            }
            const loader = document.querySelector(LOADER_SELECTOR);
            if (loader && isElementVisible(loader)) {
                const rect = loader.getBoundingClientRect();
                const desiredTop = Math.max(0, window.scrollY + rect.top - Math.floor((viewportHeight * 0.75)));
                window.scrollTo({ top: desiredTop, behavior: 'smooth' });
                await sleep(300);
                const gone = await waitForLoaderGone(LOADER_MAX_WAIT);
                if (!gone) { window.scrollTo({ top: targetY, behavior: 'smooth' }); await sleep(600); return; }
                await sleep(200);
                continue;
            } else {
                const nextY = Math.min(targetY, window.scrollY + SCROLL_STEP);
                window.scrollTo({ top: nextY, behavior: 'smooth' });
                await sleep(SCROLL_DELAY + 80);
            }
            if (Date.now() - start > maxTotal) return;
        }
    }

    async function waitForStableBattleCount(prevCount) {
        return new Promise(resolve => {
            const start = Date.now();
            let lastCount = prevCount;
            let lastChangeAt = Date.now();
            const check = () => {
                const now = Date.now();
                const current = getBattleCount();
                if (current !== lastCount) { lastCount = current; lastChangeAt = now; }
                if (now - lastChangeAt >= STABLE_REQUIRED_MS) { resolve({ changed: current > prevCount, count: current }); return; }
                if (now - start >= STABLE_MAX_WAIT) { resolve({ changed: current > prevCount, count: current }); return; }
                setTimeout(check, STABLE_POLL_MS);
            };
            setTimeout(check, STABLE_POLL_MS);
        });
    }

    function findNextHistoryLink() {
        const anchors = Array.from(document.querySelectorAll('a[href*="/battles/history?before="]'));
        for (const a of anchors) return a;
        return null;
    }

    const MY_TAG = PLAYER_TAG.toUpperCase();

    function stripCardName(raw) {
        if (!raw) return '';
        return String(raw).replace(/\s*\(.*?\)/g, '').replace(/\s+Lvl\s*\d+/i, '').trim();
    }

    function toLocalStringFromPossibleUTCString(utcString) {
        if (!utcString) return '';
        try {
            let cleaned = String(utcString).trim();
            if (/\bUTC\b/.test(cleaned)) {
                cleaned = cleaned.replace(/\s*UTC\s*$/, '');
                if (!/T/.test(cleaned)) cleaned = cleaned.replace(' ', 'T');
                cleaned = cleaned + 'Z';
            }
            const d = new Date(cleaned);
            if (isNaN(d)) return '';
            return d.toLocaleString();
        } catch (e) { return ''; }
    }

    // main battle formatter (kept largely intact)
    function formatBattle(battleEl) {
        if (!battleEl) return null;
        const idAttr = battleEl.id || '';
        const idRaw = (idAttr || (battleEl.getAttribute('data-id') || '')).toString();
        const id = idRaw.replace(/^battle_/, '').trim();

        const timeNode = battleEl.querySelector('.battle-timestamp-popup') || battleEl.querySelector('[data-content*="UTC"]') || battleEl.querySelector('.i18n_duration_short');
        const timestampRaw = timeNode ? (timeNode.getAttribute('data-content') || safeText(timeNode)) : '';
        const timeNum = parseTimeToNumber(timestampRaw);
        const localTime = toLocalStringFromPossibleUTCString(timestampRaw);

        const ribbon = battleEl.querySelector('.ui.ribbon.label') || battleEl.querySelector('.result .ui.header') || battleEl.querySelector('.win_loss .ui.right.ribbon.label');
        const resultText = ribbon ? safeText(ribbon) : '';
        const scoreEl = battleEl.querySelector('.result_header');
        const scoreText = scoreEl ? safeText(scoreEl) : '';

        function statByIconIn(container, cls) {
            if (!container) return '';
            let node = container.querySelector('.' + cls);
            if (!node) {
                const simpleName = cls.replace(/^icon-/, '');
                node = Array.from(container.querySelectorAll('[class*="' + simpleName + '"]')).find(n => n);
                if (!node) {
                    const alt = Array.from(container.querySelectorAll('.item, .stats, .value')).find(n => safeText(n).toLowerCase().includes(simpleName.replace(/-/g,' ')));
                    if (alt) {
                        const v = alt.querySelector('.value, .stat-value, .number');
                        const raw = v ? safeText(v) : safeText(alt);
                        return cleanStatRaw(raw);
                    }
                    return '';
                }
            }
            const containerItem = node.closest('.item') || node.parentElement || node;
            const v = containerItem ? (containerItem.querySelector('.value') || containerItem.querySelector('.stat-value') || containerItem.querySelector('.number')) : null;
            const raw = v ? safeText(v) : safeText(containerItem);
            return cleanStatRaw(raw);
        }

        const teamSegments = Array.from(battleEl.querySelectorAll('.team-segment'));
        let players = [];
        if (teamSegments.length) {
            players = teamSegments.map((seg) => {
                const nameEl = seg.querySelector('.player_name_header') || seg.querySelector('.ui.header.link.player_name_header') || seg.querySelector('.player_name');
                const clanEl = seg.querySelector('.battle_player_clan');
                const trophyMain = seg.querySelector('.trophy_container > .ui.label') || seg.querySelector('.trophy_container .ui.label');
                const trophyChangeEl = seg.querySelector('.trophy_container .ui.basic.label') || seg.querySelector('.trophy_container .ui.basic.red.label') || seg.querySelector('.trophy_container .ui.basic.blue.label');
                const trophyChangeRaw = trophyChangeEl ? safeText(trophyChangeEl) : '';
                const trophyChangeMatch = trophyChangeRaw.match(/([+-]?\d+)/);
                const trophyChange = trophyChangeMatch ? trophyChangeMatch[0] : (trophyChangeRaw || '');
                const deckGrid = seg.querySelector('.ui.padded.grid[id^="deck_"], .ui.padded.grid');
                let deck = [];
                if (deckGrid) {
                    deck = Array.from(deckGrid.querySelectorAll('img.deck_card, .deck_card__four_wide img')).map(img => {
                        const nm = img ? (img.alt || img.getAttribute('data-card-key') || '') : '';
                        const lvlNode = img && img.closest('.deck_card__four_wide') ? img.closest('.deck_card__four_wide').querySelector('.card-level, .ui.basic.center.card-level') : null;
                        const lvl = lvlNode ? safeText(lvlNode).replace(/^Lvl\s*/i,'') : '';
                        return nm ? (nm + (lvl ? ' (' + lvl + ')' : '')) : '';
                    }).filter(Boolean);
                }

                const statsContainer = seg.querySelector('.stats.item') || seg.querySelector('.stats') || seg;
                const avgElixir = statByIconIn(statsContainer, 'icon-average-elixir') || '';
                const shortestCycle = statByIconIn(statsContainer, 'icon-shortest-cycle') || statByIconIn(statsContainer, 'icon-shortest-cycle') || '';
                const elixirLeaked = statByIconIn(statsContainer, 'icon-elixir-leaked') || '';
                let hpTextLocal = '';
                const hpPopupLocal = statsContainer ? (statsContainer.querySelector('.hp-popup') || statsContainer.querySelector('.hp-both-popup')) : null;
                if (hpPopupLocal) {
                    const teamTotal = hpPopupLocal.getAttribute('data-total') || hpPopupLocal.getAttribute('data-team-total') || '';
                    const king = hpPopupLocal.getAttribute('data-king') || '';
                    const p0 = hpPopupLocal.getAttribute('data-princess0') || '';
                    const p1 = hpPopupLocal.getAttribute('data-princess1') || '';
                    if (teamTotal || king || p0 || p1) {
                        if (teamTotal) hpTextLocal = teamTotal + ' HP';
                        else {
                            const parts = [];
                            if (king) parts.push('King:' + king);
                            if (p0) parts.push('P0:' + p0);
                            if (p1) parts.push('P1:' + p1);
                            hpTextLocal = parts.join(' / ');
                        }
                    } else hpTextLocal = safeText(hpPopupLocal);
                } else {
                    const hpAlt = Array.from(seg.querySelectorAll('.hp, .hp-popup, .hp-both-popup')).find(n => n);
                    if (hpAlt) hpTextLocal = hpAlt.getAttribute('data-total') || safeText(hpAlt) || '';
                }

                let princessLevel = '';
                const levelNode = seg.querySelector('.level');
                if (levelNode) {
                    const textCombined = safeText(levelNode).replace(/\u00A0/g,' ');
                    const lvlMatch = textCombined.match(/Lvl\s*([0-9]+)/i) || textCombined.match(/level\s*([0-9]+)/i) || textCombined.match(/(\d+)\s*$/);
                    if (lvlMatch) princessLevel = lvlMatch[1];
                } else {
                    const princessImg = seg.querySelector('img[alt*="Princess"], img[alt*="princess"], [data-card-key*="princess"]');
                    if (princessImg) {
                        const lvlNode2 = princessImg.closest('.deck_card__four_wide') ? princessImg.closest('.deck_card__four_wide').querySelector('.card-level, .ui.basic.center.card-level') : null;
                        if (lvlNode2) {
                            const lvlText = safeText(lvlNode2).replace(/^Lvl\s*/i,'');
                            princessLevel = lvlText || '';
                        }
                    }
                }

                return {
                    name: nameEl ? safeText(nameEl) : '',
                    clan: clanEl ? safeText(clanEl) : '',
                    trophies: trophyMain ? safeText(trophyMain) : '',
                    trophyChange: trophyChange || '',
                    trophyAfter: '',
                    deck: deck,
                    stats: {
                        avgElixir: avgElixir,
                        shortestCycle: shortestCycle,
                        elixirLeaked: elixirLeaked,
                        hp: hpTextLocal
                    },
                    princessLevel: princessLevel
                };
            });
        } else {
            const playerBlocks = Array.from(battleEl.querySelectorAll('.battle_player, .player'));
            players = playerBlocks.slice(0,2).map(pb => {
                const nameEl = pb.querySelector('.player_name_header') || pb.querySelector('.player_name') || pb.querySelector('a');
                const clanEl = pb.querySelector('.battle_player_clan, .clan');
                const trophyMain = pb.querySelector('.trophy_container > .ui.label, .trophy');
                const trophyChangeEl = pb.querySelector('.trophy_container .ui.basic.label');
                const trophyChangeRaw = trophyChangeEl ? safeText(trophyChangeEl) : '';
                const trophyChangeMatch = trophyChangeRaw.match(/([+-]?\d+)/);
                const trophyChange = trophyChangeMatch ? trophyChangeMatch[0] : trophyChangeRaw;
                const deckImgs = pb.querySelectorAll('img.deck_card, .deck_card__four_wide img');
                let deck = Array.from(deckImgs).map(img => {
                    const nm = img ? (img.alt || img.getAttribute('data-card-key') || '') : '';
                    const lvlNode = img && img.closest('.deck_card__four_wide') ? img.closest('.deck_card__four_wide').querySelector('.card-level, .ui.basic.center.card-level') : null;
                    const lvl = lvlNode ? safeText(lvlNode).replace(/^Lvl\s*/i,'') : '';
                    return nm ? (nm + (lvl ? ' (' + lvl + ')' : '')) : '';
                }).filter(Boolean);

                const statsContainer = pb.querySelector('.stats.item') || pb.querySelector('.stats') || pb;
                const avgElixir = statByIconIn(statsContainer, 'icon-average-elixir') || '';
                const shortestCycle = statByIconIn(statsContainer, 'icon-shortest-cycle') || statByIconIn(statsContainer, 'icon-shortest-cycle') || '';
                const elixirLeaked = statByIconIn(statsContainer, 'icon-elixir-leaked') || '';

                let hpTextLocal = '';
                const hpPopupLocal = statsContainer ? (statsContainer.querySelector('.hp-popup') || statsContainer.querySelector('.hp-both-popup')) : null;
                if (hpPopupLocal) {
                    const teamTotal = hpPopupLocal.getAttribute('data-total') || hpPopupLocal.getAttribute('data-team-total') || '';
                    const king = hpPopupLocal.getAttribute('data-king') || '';
                    const p0 = hpPopupLocal.getAttribute('data-princess0') || '';
                    const p1 = hpPopupLocal.getAttribute('data-princess1') || '';
                    if (teamTotal) hpTextLocal = teamTotal + ' HP';
                    else {
                        const parts = [];
                        if (king) parts.push('King:' + king);
                        if (p0) parts.push('P0:' + p0);
                        if (p1) parts.push('P1:' + p1);
                        hpTextLocal = parts.join(' / ');
                    }
                } else {
                    const hpAlt = Array.from(pb.querySelectorAll('.hp, .hp-popup, .hp-both-popup')).find(n => n);
                    if (hpAlt) hpTextLocal = hpAlt.getAttribute('data-total') || safeText(hpAlt) || '';
                }

                let princessLevel = '';
                const levelNode = pb.querySelector('.level');
                if (levelNode) {
                    const textCombined = safeText(levelNode).replace(/\u00A0/g,' ');
                    const lvlMatch = textCombined.match(/Lvl\s*([0-9]+)/i) || textCombined.match(/level\s*([0-9]+)/i) || textCombined.match(/(\d+)\s*$/);
                    if (lvlMatch) princessLevel = lvlMatch[1];
                } else {
                    const princessImg = pb.querySelector('img[alt*="Princess"], img[alt*="princess"], [data-card-key*="princess"]');
                    if (princessImg) {
                        const lvlNode2 = princessImg.closest('.deck_card__four_wide') ? princessImg.closest('.deck_card__four_wide').querySelector('.card-level, .ui.basic.center.card-level') : null;
                        if (lvlNode2) princessLevel = safeText(lvlNode2).replace(/^Lvl\s*/i,'');
                    }
                }

                return {
                    name: nameEl ? safeText(nameEl) : '',
                    clan: clanEl ? safeText(clanEl) : '',
                    trophies: trophyMain ? safeText(trophyMain) : '',
                    trophyChange: trophyChange || '',
                    trophyAfter: '',
                    deck: deck,
                    stats: {
                        avgElixir: avgElixir,
                        shortestCycle: shortestCycle,
                        elixirLeaked: elixirLeaked,
                        hp: hpTextLocal
                    },
                    princessLevel: princessLevel
                };
            });
        }

        let meIndex = -1;
        try {
            const aLeft = battleEl.querySelector('.team-segment:nth-child(1) a[href*="/player/"], .player:nth-child(1) a[href*="/player/"]');
            const aRight = battleEl.querySelector('.team-segment:nth-child(2) a[href*="/player/"], .player:nth-child(2) a[href*="/player/"]');
            if (aLeft) {
                const m = aLeft.getAttribute('href').match(/player\/([^\/]+)/i);
                if (m && m[1] && m[1].toUpperCase() === MY_TAG) { if (players[0]) { players[0].name = 'Me'; players[0].clan = ''; meIndex = 0; } }
            }
            if (aRight) {
                const m = aRight.getAttribute('href').match(/player\/([^\/]+)/i);
                if (m && m[1] && m[1].toUpperCase() === MY_TAG) { if (players[1]) { players[1].name = 'Me'; players[1].clan = ''; meIndex = 1; } }
            }
            const tagSource = battleEl.querySelector('[data-team-tags], [data-player-tags], [data-opponent-tags]');
            if (tagSource) {
                const t = (tagSource.getAttribute('data-team-tags') || tagSource.getAttribute('data-player-tags') || '').toUpperCase();
                const ot = (tagSource.getAttribute('data-opponent-tags') || '').toUpperCase();
                const teamTags = t.split(',').map(s=>s.trim()).filter(Boolean);
                const oppoTags = ot.split(',').map(s=>s.trim()).filter(Boolean);
                if (teamTags.length && teamTags.some(tt => tt === MY_TAG)) { if (players[0]) { players[0].name = 'Me'; players[0].clan = ''; meIndex = 0; } }
                if (oppoTags.length && oppoTags.some(tt => tt === MY_TAG)) { if (players[1]) { players[1].name = 'Me'; players[1].clan = ''; meIndex = 1; } }
            }
        } catch (e) {}

        const playersForText = players.map(p => { if (!p) return p; if (p.name === 'Me') return p; return { ...p, name: 'Opponent', clan: '' }; });

        const headerParts = [];
        const mode = (battleEl.querySelector('.game_mode_header') ? safeText(battleEl.querySelector('.game_mode_header')) : '');
        if (mode) headerParts.push(mode);
        if (localTime) headerParts.push(localTime);

        let out = (headerParts.length ? headerParts.join(' — ') + '\n' : '');
        const durationNode = battleEl.querySelector('.i18n_duration_short, .battle-duration, .duration');
        const durationText = durationNode ? safeText(durationNode) : '';
        if (durationText) out += durationText + ' Ago\n';
        if (resultText || scoreText) out += 'Result: ' + (resultText ? resultText + (scoreText ? ' (' + scoreText + ')' : '') : scoreText) + '\n';

        playersForText.forEach((p, idx) => {
            out += (idx === 0 ? 'Player 1: ' : 'Player 2: ') + (p.name || '') ;
            if (p.trophies) out += ' — ' + p.trophies;
            if (p.trophyChange) {
                const delta = (String(p.trophyChange).startsWith('+') || String(p.trophyChange).startsWith('-')) ? p.trophyChange : (p.trophyChange ? ( (p.trophyChange>0?'+':'') + p.trophyChange ) : '');
                out += ' (' + delta + (p.trophyAfter ? ' → ' + p.trophyAfter : '') + ')';
            }
            out += '\n';
            if (p.deck && p.deck.length) {
                out += '  Deck: ' + p.deck.join(', ') + '\n';
            }

            const orig = players[idx] || {};
            const sParts = [];
            if (orig.stats && orig.stats.avgElixir) sParts.push('Avg Elixir: ' + orig.stats.avgElixir);
            if (orig.stats && orig.stats.shortestCycle) sParts.push('4-Card Cycle: ' + orig.stats.shortestCycle);
            if (orig.stats && orig.stats.elixirLeaked) sParts.push('Elixir Leaked: ' + orig.stats.elixirLeaked);
            if (orig.stats && orig.stats.hp) sParts.push('HP: ' + orig.stats.hp);
            if (sParts.length) out += '  Stats: ' + sParts.join(' • ') + '\n';

            if (orig.princessLevel) {
                out += 'Tower Princess: LvL ' + orig.princessLevel + '\n';
            }
        });

        const hpPopup = battleEl.querySelector('.hp-popup') || battleEl.querySelector('.hp-both-popup');
        let hpText = '';
        if (hpPopup) {
            const teamTotal = hpPopup.getAttribute('data-total') || hpPopup.getAttribute('data-team-total') || '';
            const oppoTotal = hpPopup.getAttribute('data-oppo-total') || '';
            if (teamTotal || oppoTotal) hpText = (teamTotal ? teamTotal : '') + (oppoTotal ? ' vs ' + oppoTotal : '');
            else hpText = safeText(hpPopup);
        }
        if (hpText) out += 'HP: ' + hpText + '\n';

        let winnerIndex = -1;
        try {
            const segs = Array.from(battleEl.querySelectorAll('.team-segment'));
            if (segs.length >= 2) {
                for (let i = 0; i < segs.length; i++) {
                    const seg = segs[i];
                    const r = seg.querySelector('.ui.right.ribbon.label, .ui.ribbon.label, .winner, .won, .victory, .victory-label');
                    if (r && safeText(r).toLowerCase().includes('win')) { winnerIndex = i; break; }
                }
            }
            if (winnerIndex === -1) {
                const maybeWinner = battleEl.querySelector('[class*="team-winner"], .team-winner, .winner, .won, .victory');
                if (maybeWinner) {
                    for (let i = 0; i < segs.length; i++) {
                        if (segs[i].contains(maybeWinner)) { winnerIndex = i; break; }
                    }
                }
            }
            if (winnerIndex === -1 && players && players.length >= 2) {
                const p0 = parseInt((players[0].trophyChange || '').replace(/[^\d-+]/g,''), 10);
                const p1 = parseInt((players[1].trophyChange || '').replace(/[^\d-+]/g,''), 10);
                if (!isNaN(p0) && !isNaN(p1)) {
                    if (p0 > p1) winnerIndex = 0;
                    else if (p1 > p0) winnerIndex = 1;
                }
            }
            if (winnerIndex === -1 && resultText) {
                if (/win|victory|victorious/i.test(resultText)) {
                    const leftWin = battleEl.querySelector('.team-segment:nth-child(1) .ui.ribbon.label') && /win/i.test(safeText(battleEl.querySelector('.team-segment:nth-child(1) .ui.ribbon.label')));
                    const rightWin = battleEl.querySelector('.team-segment:nth-child(2) .ui.ribbon.label') && /win/i.test(safeText(battleEl.querySelector('.team-segment:nth-child(2) .ui.ribbon.label')));
                    if (leftWin && !rightWin) winnerIndex = 0;
                    else if (rightWin && !leftWin) winnerIndex = 1;
                }
            }
        } catch (e) {}

        let meLost = false;
        if (meIndex === -1) meLost = false;
        else if (winnerIndex !== -1) meLost = (winnerIndex !== meIndex);
        else {
            try {
                const meChange = players[meIndex] ? parseInt(String(players[meIndex].trophyChange || '').replace(/[^\d-+]/g,''), 10) : NaN;
                if (!isNaN(meChange)) meLost = meChange < 0;
                else meLost = /lose|lost|defeat/i.test(resultText);
            } catch (e) { meLost = false; }
        }

        let meDeck = [];
        let opponentDeck = [];
        try {
            if (meIndex !== -1) {
                meDeck = (players[meIndex] && players[meIndex].deck) ? players[meIndex].deck.map(stripCardName).filter(Boolean) : [];
                const oppIdx = meIndex === 0 ? 1 : 0;
                opponentDeck = (players[oppIdx] && players[oppIdx].deck) ? players[oppIdx].deck.map(stripCardName).filter(Boolean) : [];
            } else {
                meDeck = [];
                opponentDeck = (players[1] && players[1].deck) ? players[1].deck.map(stripCardName).filter(Boolean) : (players[0] && players[0].deck ? players[0].deck.map(stripCardName).filter(Boolean) : []);
            }
        } catch (e) { meDeck = []; opponentDeck = []; }

        let meStats = null;
        let opponentStats = null;
        if (players && players.length) {
            if (meIndex !== -1) {
                meStats = players[meIndex] ? { ...players[meIndex].stats, princessLevel: players[meIndex].princessLevel || '' } : null;
                const oppIdx = meIndex === 0 ? 1 : 0;
                opponentStats = players[oppIdx] ? { ...players[oppIdx].stats, princessLevel: players[oppIdx].princessLevel || '' } : null;
            } else {
                meStats = players[0] ? { ...players[0].stats, princessLevel: players[0].princessLevel || '' } : null;
                opponentStats = players[1] ? { ...players[1].stats, princessLevel: players[1].princessLevel || '' } : null;
            }
        }

        return {
            id: id || '',
            text: out.trim(),
            timeNum: timeNum || Date.now(),
            meLost: !!meLost,
            meDeck: meDeck,
            opponentDeck: opponentDeck,
            meStats: meStats,
            opponentStats: opponentStats
        };
    }

// Losses analysis builder (updated to analyze across matches and show top = half of matches)
function buildLossesAnalysisSection(battlesArray) {
    try {
        if (!Array.isArray(battlesArray) || !battlesArray.length) {
            return 'Losses analysis: No battles available to analyze.';
        }

        const totalBattles = Math.min(battlesArray.length, MAX_BATTLES_TO_KEEP);
        const recent = battlesArray.slice(0, totalBattles);

        // Шаг 1: считаем появления карт по ВСЕМ матчам (по одному засчитанному появлению карты в матче)
        const counts = new Map();
        for (const match of recent) {
            const oppDeck = Array.isArray(match.opponentDeck) ? match.opponentDeck : [];
            const uniqueThisMatch = new Set(oppDeck.map(c => stripCardName(c)));
            for (const cardName of uniqueThisMatch) {
                if (!cardName) continue;
                counts.set(cardName, (counts.get(cardName) || 0) + 1);
            }
        }

        const matchCount = recent.length;
        if (!counts.size) {
            return `Losses analysis: no opponent cards parsed from the last ${matchCount} battles.`;
        }

        // Шаг 2: формируем массив с процентами относительно ВСЕХ матчей
        const arr = Array.from(counts.entries()).map(([card, cnt]) => {
            const perc = Math.round((cnt / matchCount) * 100);
            return { card, cnt, perc };
        });

        // Сортируем по частоте, затем по проценту, затем по имени
        arr.sort((a, b) => {
            if (b.cnt !== a.cnt) return b.cnt - a.cnt;
            if (b.perc !== a.perc) return b.perc - a.perc;
            return a.card.localeCompare(b.card);
        });

        // Шаг 3: вычисляем размер топа = половина матчей (округляем вверх), но не больше длины массива
        const topSize = Math.min(arr.length, Math.max(1, Math.ceil(matchCount / 2)));

        const lines = [];
        lines.push(`Opponent cards analysis (last ${matchCount} battles):`);
        lines.push(`Top ${topSize} cards (half of the matches, rounded up):`);
        for (let i = 0; i < topSize; i++) {
            const t = arr[i];
            lines.push(`${i+1}) ${t.card} — ${t.perc}% (${t.cnt} / ${matchCount} matches)`);
        }

        return lines.join('\n');
    } catch (e) {
        console.error(e);
        return 'Losses analysis: error while analyzing.';
    }
}

    // Insert copy button into page if final text present
    function insertCopyButtonIfReady() {
        try {
            const finalText = sessionGet(KEY_FINAL_TEXT);
            const stage = sessionGet(KEY_AUTOFLOW_STAGE);
            if (!finalText || (stage !== 'done' && stage !== 'ready_to_copy')) return;
            if (document.getElementById('__ra_copy_btn')) return;

            // Add styles only once
            if (!document.getElementById('__ra_copy_styles')) {
                const style = document.createElement('style');
                style.id = '__ra_copy_styles';
                style.textContent = `
#__ra_copy_container { position: fixed; right: 16px; bottom: 16px; z-index: 999999; font-family: Arial, sans-serif; display:flex; gap:10px; align-items:center; pointer-events:auto; }
#__ra_copy_btn { padding: 12px 16px; border-radius: 12px; border: none; background: linear-gradient(135deg,#ff7a18 0%,#af002d 100%); color:#fff; font-weight:700; font-size:14px; cursor:pointer; box-shadow: 0 8px 24px rgba(175,0,45,0.28), 0 2px 6px rgba(0,0,0,0.12); display:inline-flex; align-items:center; gap:8px; transform-origin: center; transition: transform 160ms ease, box-shadow 160ms; }
#__ra_copy_btn svg { width:16px; height:16px; display:inline-block; vertical-align:middle; }
#__ra_copy_btn:hover { transform: translateY(-3px) scale(1.02); box-shadow: 0 12px 30px rgba(175,0,45,0.32), 0 4px 10px rgba(0,0,0,0.14); }
#__ra_copy_status { font-size:13px; color:#111; min-width:80px; text-align:center; background: rgba(255,255,255,0.95); padding:8px 10px; border-radius:10px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
@keyframes __ra_pulse { 0% { box-shadow: 0 8px 24px rgba(175,0,45,0.18); } 50% { box-shadow: 0 12px 30px rgba(175,0,45,0.28); } 100% { box-shadow: 0 8px 24px rgba(175,0,45,0.18); } }
#__ra_copy_btn.__pulse { animation: __ra_pulse 1800ms infinite; }
#__ra_copy_container.fade-out { transition: opacity 380ms ease, transform 380ms ease; opacity:0; transform: scale(0.92); pointer-events:none; }
`;
                document.head.appendChild(style);
            }

            const container = document.createElement('div');
            container.id = '__ra_copy_container';

            const btn = document.createElement('button');
            btn.id = '__ra_copy_btn';
            // Add SVG clipboard icon
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 2h6a1 1 0 0 1 1 1v1h-8V3a1 1 0 0 1 1-1z" fill="#ffffff" opacity="0.12"/><path d="M7 4h10v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4z" fill="#fff" opacity="0.06"/><path d="M16 2H8a2 2 0 0 0-2 2v16a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V4a2 2 0 0 0-2-2z" fill="#fff" opacity="0.04"/><path d="M9 7h6v2H9z" fill="white"/><path d="M8 11h8v1H8z" fill="white" opacity="0.9"/></svg><span>Copy template</span>`;

            btn.title = 'Copy final template';
            btn.setAttribute('aria-label', 'Copy final template');
            btn.classList.add('__pulse');

            const status = document.createElement('div');
            status.id = '__ra_copy_status';
            status.style.fontSize = '13px';
            status.style.color = '#222';
            status.textContent = 'Ready';

            btn.addEventListener('click', async (ev) => {
                ev.preventDefault();
                if (btn.disabled) return;
                btn.disabled = true;
                btn.classList.remove('__pulse');
                status.textContent = 'Copying...';
                try {
                    await copyToClipboardSafariSafe(finalText);
                    status.textContent = 'Copied';
                    // clear transient session data on success
                    sessionRemove(KEY_BATTLES_DATA);
                    sessionRemove(KEY_RESUME_META);
                    // Optional: remove final text from session to avoid re-copying stale data
                    // sessionRemove(KEY_FINAL_TEXT);

                    // animate disappearance
                    setTimeout(() => {
                        try {
                            container.classList.add('fade-out');
                            setTimeout(() => { if (container && container.parentElement) container.parentElement.removeChild(container); }, 420);
                        } catch (e) { try { if (container && container.parentElement) container.parentElement.removeChild(container); } catch (ee) {} }
                    }, 280);
                } catch (err) {
                    console.error('Copy failed', err);
                    status.textContent = 'Failed';
                    btn.classList.add('__pulse');
                    btn.disabled = false;
                    // Show full text in a prompt as last resort (first 10000 chars)
                    try {
                        window.prompt('Copy the text below (Ctrl/Cmd+C):', finalText.slice(0, 10000));
                    } catch (e) {}
                }
            });

            container.appendChild(btn);
            container.appendChild(status);
            document.body.appendChild(container);

            // accessibility: focus button so user sees it
            try { btn.focus({preventScroll:true}); } catch (e) {}
        } catch (e) { console.error(e); }
    }

    // Main auto collect flow, but instead of auto-copy, save final text and show copy button
    async function autoCollectBattlesAndNavigate() {
        if (window.__ra_auto_battles_running) return;
        window.__ra_auto_battles_running = true;
        try {
            while (true) {
                const prevCount = getBattleCount();
                await autoScrollToBottomRespectLoader();
                const waitRes = await waitForStableBattleCount(prevCount);
                const parsed = collectBattlesFromDOM();
                const stored = sessionGet(KEY_BATTLES_DATA) || [];
                const map = new Map();
                const concatArr = stored.concat(parsed);
                for (let i = 0; i < concatArr.length; i++) {
                    const p = concatArr[i];
                    if (!p) continue;
                    const key = p.id ? String(p.id) : ('t' + (p.timeNum || Date.now()) + '_' + i);
                    if (!map.has(key)) map.set(key, p);
                    else {
                        const exist = map.get(key);
                        if ((p.timeNum || 0) > (exist.timeNum || 0)) map.set(key, p);
                    }
                }
                const mergedArray = Array.from(map.values());
                mergedArray.sort((a,b) => (b.timeNum||0) - (a.timeNum||0));
                const kept = mergedArray.slice(0, MAX_BATTLES_TO_KEEP);
                sessionSet(KEY_BATTLES_DATA, kept.map(({id,text,timeNum,meLost,meDeck,opponentDeck})=>({id,text,timeNum,meLost,meDeck,opponentDeck})));
                if (kept.length >= MAX_BATTLES_TO_KEEP) {
                    const finalStored = sessionGet(KEY_BATTLES_DATA) || [];
                    finalStored.sort((a,b) => (b.timeNum||0) - (a.timeNum||0));
                    const finalTexts = finalStored.slice(0, MAX_BATTLES_TO_KEEP).map(p => p.text);
                    const battlesJoined = finalTexts.join('\n\n---\n\n');
                    const cardsText = sessionGet(KEY_CARDS_TEXT) || '';
                    const analysisSection = buildLossesAnalysisSection(finalStored);
                    const finalTemplate =
`пожалуйста, проанализируй логи и найди способ как максимально эффективно изменить колоду чтобы перестать проигрывать, когда будешь отправлять колоду - сделай название каждой карты на каждую строку и без нумерации, подробные логи ниже ⬇️ 

my cards:

${cardsText || '*no card data*'}

my battles (last ${Math.min(finalTexts.length, MAX_BATTLES_TO_KEEP)}):

${battlesJoined || '*no battle data*'}

${analysisSection}`;
                    sessionSet(KEY_FINAL_TEXT, finalTemplate);
                    sessionSet(KEY_AUTOFLOW_STAGE, 'done');
                    // keep battles data until user copies; show button
                    insertCopyButtonIfReady();
                    window.__ra_auto_battles_running = false;
                    return;
                }
                const nextA = findNextHistoryLink();
                if (nextA && nextA.href) {
                    const href = nextA.href;
                    sessionSet(KEY_RESUME_META, { from: location.href, next: href, ts: Date.now() });
                    sessionSet(KEY_AUTOFLOW_STAGE, 'battles_collecting');
                    await sleep(400);
                    location.href = href;
                    return;
                } else {
                    const finalStored = sessionGet(KEY_BATTLES_DATA) || [];
                    finalStored.sort((a,b) => (b.timeNum||0) - (a.timeNum||0));
                    const finalTexts = finalStored.slice(0, MAX_BATTLES_TO_KEEP).map(p => p.text);
                    const battlesJoined = finalTexts.join('\n\n---\n\n');
                    const cardsText = sessionGet(KEY_CARDS_TEXT) || '';
                    const analysisSection = buildLossesAnalysisSection(finalStored);
                    const finalTemplate =
`пожалуйста, проанализируй логи и найди способ как максимально эффективно изменить колоду чтобы перестать проигрывать, когда будешь отправлять колоду - сделай название каждой карты на каждую строку и без нумерации, подробные логи ниже ⬇️ 

my cards:

${cardsText || '*no card data*'}

my battles (last ${Math.min(finalTexts.length, MAX_BATTLES_TO_KEEP)}):

${battlesJoined || '*no battle data*'}

${analysisSection}`;
                    sessionSet(KEY_FINAL_TEXT, finalTemplate);
                    sessionSet(KEY_AUTOFLOW_STAGE, 'done');
                    insertCopyButtonIfReady();
                    window.__ra_auto_battles_running = false;
                    return;
                }
            }
        } catch (e) {
            console.error('Auto collect battles error', e);
            window.__ra_auto_battles_running = false;
        }
    }

    // If on battles path, start
    (async function resumeBattlesIfNeeded() {
        const path = location.pathname;
        if (!path.startsWith(BATTLES_PATH)) {
            // still try to show copy button if final text exists and stage done
            insertCopyButtonIfReady();
            return;
        }
        await sleep(400);
        const stage = sessionGet(KEY_AUTOFLOW_STAGE);
        if (stage === 'cards_collected' || stage === 'battles_collecting' || stage === 'start' || !stage) {
            await autoCollectBattlesAndNavigate();
        } else {
            insertCopyButtonIfReady();
        }
    })();

    // Also try to insert button when page fully loaded in case final text already present
    window.addEventListener('load', () => { setTimeout(insertCopyButtonIfReady, 350); });

    log('RA-AUTO script loaded. Current path:', location.pathname, 'MIN_CARD_LEVEL=', MIN_CARD_LEVEL);
})();
