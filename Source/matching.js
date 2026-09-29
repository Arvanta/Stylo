/* Shared matching and target validation for popup, manager, and content script. */
const StyloMatch = (() => {
  const MAX_REGEX_LENGTH = 256;
  const MAX_PREFIX_LENGTH = 2048;
  const MAX_FINITE_REPEAT = 10000;

  function normalizeDomain(value) {
    let raw = String(value ?? '').trim();
    if (!raw) throw new Error('Enter a domain.');

    const isUrl = /^https?:\/\//i.test(raw);
    if (isUrl) {
      let u;
      try { u = new URL(raw); } catch { throw new Error('Enter a valid domain, without a path.'); }
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port ||
          u.pathname !== '/' || u.search || u.hash) {
        throw new Error('For domain matching, enter only a hostname. Use URL Prefix for a path.');
      }
      raw = u.hostname;
    } else {
      // A trailing slash is a common harmless typo; other URL parts are not domains.
      if (raw.endsWith('/') && !raw.endsWith('//')) raw = raw.slice(0, -1);
      if (/[\s/?#@]/.test(raw) || raw.includes('://') || /:\d+$/.test(raw)) {
        throw new Error('For domain matching, enter only a hostname. Use URL Prefix for a path or port.');
      }
      try {
        const u = new URL(`http://${raw}`);
        if (u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) {
          throw new Error('Enter a hostname only.');
        }
        raw = u.hostname;
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Enter a hostname')) throw e;
        throw new Error('Enter a valid hostname, such as example.com.');
      }
    }

    const result = raw.toLowerCase().replace(/\.$/, '');
    if (!result) throw new Error('Enter a valid hostname.');
    return result;
  }

  function isRiskyRegex(pattern) {
    // Reject common exponential-backtracking shapes before the pattern is
    // stored or run on a page URL. This is deliberately conservative, not a
    // proof that every accepted JavaScript RegExp has bounded runtime.
    const groups = [{ hasQuantifier: false, hasAlternation: false }];
    let lastAtom = null;
    let unboundedCount = 0;
    let escaped = false;
    let inClass = false;

    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];

      if (escaped) {
        // Backreferences can make otherwise-simple expressions highly
        // backtracking-sensitive; Stylo's URL matcher does not need them.
        if (!inClass && ((ch >= '1' && ch <= '9') ||
            (ch === 'k' && pattern[i + 1] === '<'))) return true;
        escaped = false;
        lastAtom = { type: 'atom' };
        continue;
      }
      if (ch === '\\') { escaped = true; continue; }

      if (inClass) {
        if (ch === ']') {
          inClass = false;
          lastAtom = { type: 'atom' };
        }
        continue;
      }
      if (ch === '[') {
        inClass = true;
        lastAtom = null;
        continue;
      }

      if (ch === '(') {
        const next = pattern[i + 1];
        if (next === '?') {
          const kind = pattern[i + 2];
          if (kind === ':' || kind === '=' || kind === '!') {
            i += 2; // non-capturing group, lookahead, or negative lookahead
          } else if (kind === '<') {
            if (pattern[i + 3] === '=' || pattern[i + 3] === '!') {
              i += 3; // lookbehind
            } else {
              const endName = pattern.indexOf('>', i + 3);
              if (endName !== -1) i = endName; // named capture
            }
          } else {
            // Inline modifier groups, when present, end their prefix at ':'.
            const colon = pattern.indexOf(':', i + 2);
            const close = pattern.indexOf(')', i + 2);
            if (colon !== -1 && (close === -1 || colon < close) &&
                /^[a-z-]+$/i.test(pattern.slice(i + 2, colon))) i = colon;
          }
        }
        groups.push({ hasQuantifier: false, hasAlternation: false });
        lastAtom = null;
        continue;
      }

      if (ch === ')') {
        if (groups.length > 1) {
          const group = groups.pop();
          const parent = groups[groups.length - 1];
          parent.hasQuantifier ||= group.hasQuantifier;
          parent.hasAlternation ||= group.hasAlternation;
          lastAtom = {
            type: 'group',
            hasQuantifier: group.hasQuantifier,
            hasAlternation: group.hasAlternation
          };
        } else {
          lastAtom = null; // malformed syntax is rejected by RegExp below
        }
        continue;
      }

      if (ch === '|') {
        groups[groups.length - 1].hasAlternation = true;
        lastAtom = null;
        continue;
      }

      let quantifier = null;
      if (ch === '*' || ch === '+' || ch === '?') {
        quantifier = {
          end: i + 1,
          max: ch === '*' || ch === '+' ? Infinity : 1,
          unbounded: ch === '*' || ch === '+'
        };
      } else if (ch === '{') {
        const match = pattern.slice(i).match(/^\{(\d+)(?:,(\d*))?\}/);
        if (match) {
          const min = Number(match[1]);
          const max = match[2] === undefined
            ? min
            : (match[2] === '' ? Infinity : Number(match[2]));
          if (!Number.isSafeInteger(min) || min > MAX_FINITE_REPEAT ||
              (max !== Infinity && (!Number.isSafeInteger(max) || max > MAX_FINITE_REPEAT))) return true;
          quantifier = { end: i + match[0].length, max, unbounded: match[2] === '' };
        }
      }

      if (quantifier) {
        const repeats = quantifier.max > 1;
        if (lastAtom?.type === 'group' && repeats &&
            (lastAtom.hasQuantifier || lastAtom.hasAlternation)) return true;
        if (quantifier.unbounded) unboundedCount++;
        if (unboundedCount > 8) return true;
        groups[groups.length - 1].hasQuantifier = true;
        i = quantifier.end - 1;
        // The trailing '?' makes a quantifier lazy; it is not another atom.
        if (pattern[i + 1] === '?') i++;
        lastAtom = { type: 'quantified' };
        continue;
      }

      // Anchors don't produce a repeatable atom. All other characters do.
      lastAtom = ch === '^' || ch === '$' ? null : { type: 'atom' };
    }

    // Multiple wildcard runs are another common source of excessive search.
    return /(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern);
  }

  function validateTarget(matchType, value) {
    if (!['domain', 'prefix', 'regex'].includes(matchType)) {
      throw new Error('Choose Domain, URL Prefix, or Regex matching.');
    }
    const target = String(value ?? '').trim();
    if (!target) throw new Error('Enter a non-empty match target.');

    if (matchType === 'domain') return normalizeDomain(target);

    if (matchType === 'prefix') {
      if (target.length > MAX_PREFIX_LENGTH) throw new Error('URL Prefix is too long.');
      let u;
      try { u = new URL(target); } catch { throw new Error('Enter a full URL prefix, such as https://example.com/path.'); }
      if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password) {
        throw new Error('URL Prefix must start with http:// or https:// and include a hostname.');
      }
      return u.href;
    }

    if (target.length > MAX_REGEX_LENGTH) throw new Error(`Regex is too long (maximum ${MAX_REGEX_LENGTH} characters).`);
    if (isRiskyRegex(target)) throw new Error('This Regex contains a common high-cost pattern. Simplify it before saving.');
    try { new RegExp(target); } catch { throw new Error('This regular expression is not valid.'); }
    return target;
  }

  function matches(style, url) {
    if (!style || typeof url !== 'string' || !url) return false;
    const target = typeof style.target === 'string' ? style.target.trim() : '';
    // An empty regex matches every URL; never allow it to become a global rule.
    if (!target) return false;

    try {
      if (style.matchType === 'domain') {
        const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
        const domain = normalizeDomain(target);
        return host === domain || host.endsWith('.' + domain);
      }
      if (style.matchType === 'prefix') return url.startsWith(target);
      if (style.matchType === 'regex') {
        if (target.length > MAX_REGEX_LENGTH || isRiskyRegex(target)) return false;
        return new RegExp(target).test(url);
      }
    } catch {}
    return false;
  }

  return Object.freeze({ MAX_REGEX_LENGTH, normalizeDomain, validateTarget, matches });
})();
