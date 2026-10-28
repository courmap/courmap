import type { ParsedRelease } from '@courmap/core';

// An anitomy-style approach, written from scratch: peel off the extension and bracketed tags,
// classify every tag, then read the remaining text right to left for the episode marker, and
// take what precedes it as the title (minus season and part tokens).

const EXTENSIONS = /\.(mkv|mp4|avi|m4v|webm|ts|ogm|wmv|flv|rmvb)$/i;

const RESOLUTION = /^(?:\d{3,4}[pi]|\d{3,4}x\d{3,4}|4k|2160p|uhd)$/i;
const CHECKSUM = /^[0-9a-f]{8}$/i;
const SOURCE = /^(?:bd|bdrip|bd-?rip|blu-?ray|bdmv|web|web-?dl|web-?rip|hdtv|hdtvrip|tv|tvrip|dvd|dvdrip|dvd-?rip|ld|vhs)$/i;
const VIDEO = /^(?:x264|x265|h\.?264|h\.?265|hevc|avc|av1|vp9|xvid|divx|10-?bit|hi10p?|8-?bit|hdr|dolby-?vision)$/i;
const AUDIO = /^(?:aac(?:2\.0|5\.1)?|flac|opus|ac3|e-?ac-?3|eac3|dts(?:-hd)?|ddp?(?:2\.0|5\.1)?|truehd|mp3|vorbis|lpcm|2\.0|5\.1|7\.1|(?:aac|flac|opus|ac3|e-?ac-?3|eac3|dts(?:-hd)?|ddp?|truehd|lpcm|ma)\.(?:2\.0|5\.1|7\.1))$/i;
const YEAR = /^(19[5-9]\d|20[0-4]\d)$/;
// Language codes scene names put after the title (JPN audio, KOR, ...); metadata, not part of the title.
// Streaming services that scene and web groups put after the title (CR WEB-DL, AMZN WEB-DL).
const SERVICE = /^(?:cr|crunchyroll|amzn|dsnp|nf|hidi|hidive|funi|bili|bilibili|hulu|atvp)$/i;
const LANGUAGE = /^(?:jpn|jap|kor|ger|fre|fra|ita|esp|spa|rus|por|chs|cht|multi)$/i;
// DVD scene names: "FRA PAL DVD5" (country, video system, disc size) is metadata, not title.
const DISC = /^(?:pal|ntsc|dvd[59]|bd25|bd50)$/i;

const FLAG_WORDS: Record<string, string> = {
  'dual audio': 'dual-audio',
  'dual-audio': 'dual-audio',
  dual: 'dual-audio',
  'multi sub': 'multi-sub',
  'multi-sub': 'multi-sub',
  'multi subs': 'multi-sub',
  multisub: 'multi-sub',
  uncensored: 'uncensored',
  uncen: 'uncensored',
  batch: 'batch',
  complete: 'batch',
  'complete series': 'batch',
  remastered: 'remastered',
  remux: 'remux',
  repack: 'repack',
  proper: 'proper',
  raw: 'raw',
  hardsub: 'hardsub',
  softsub: 'softsub',
  eng: 'english-sub',
  english: 'english-sub',
  vostfr: 'french-sub',
};

const SPECIAL_WORDS: Record<string, ParsedRelease['special']> = {
  movie: 'movie',
  film: 'movie',
  gekijouban: 'movie',
  ova: 'ova',
  oav: 'ova',
  oad: 'oad',
  special: 'special',
  specials: 'special',
  sp: 'special',
};

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

interface Tag {
  text: string;
  start: number;
  end: number;
}

/** Classifies one tag word; returns true when it was recognized as metadata. */
function classify(word: string, out: ParsedRelease): boolean {
  const w = word.trim();
  if (!w) return true;
  const lower = w.toLowerCase();
  if (RESOLUTION.test(w)) return (out.resolution ??= lower), true;
  if (CHECKSUM.test(w) && /[a-f]/i.test(w) === /[a-f]/i.test(w)) {
    // 8 hex digits: a CRC32, unless it is all digits and could be a date (rare in tags)
    if (!/^\d{8}$/.test(w)) return (out.checksum ??= w.toUpperCase()), true;
  }
  if (SOURCE.test(w)) return (out.source ??= lower.replace(/-/g, '')), true;
  if (VIDEO.test(w)) {
    if (/bit/i.test(w)) out.flags.push(lower.replace('-', ''));
    else out.video_codec ??= lower.replace('.', '');
    return true;
  }
  if (AUDIO.test(w)) return out.audio.push(lower), true;
  if (YEAR.test(w)) return (out.year ??= Number(w)), true;
  if (LANGUAGE.test(w)) return true;
  if (DISC.test(w)) return true;
  if (SERVICE.test(w)) return true;
  // A video-source word ("HYBRID") or a subtitle tag ("MSubs"), metadata with no field of its own.
  if (/^(?:hybrid|msubs)$/i.test(w)) return true;
  if (FLAG_WORDS[lower]) return out.flags.push(FLAG_WORDS[lower]!), true;
  return false;
}

/** Splits bracketed tags off the name and returns the remaining main text. */
function extractTags(name: string): { main: string; tags: Tag[] } {
  const tags: Tag[] = [];
  const re = /\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}|【([^】]*)】/g;
  let main = '';
  let last = 0;
  for (const m of name.matchAll(re)) {
    tags.push({ text: (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim(), start: m.index!, end: m.index! + m[0].length });
    main += `${name.slice(last, m.index)} `;
    last = m.index! + m[0].length;
  }
  main += name.slice(last);
  return { main, tags };
}

const blank = (input: string): ParsedRelease => ({
  input,
  group: null,
  title: null,
  season: null,
  part: null,
  episode: null,
  episode_to: null,
  version: null,
  special: null,
  year: null,
  resolution: null,
  source: null,
  video_codec: null,
  audio: [],
  flags: [],
  batch: false,
  checksum: null,
  extension: null,
});

const ordinal = (n: string) => Number(n);

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** RSS titles are HTML: "Ranma1.&amp;.2" is "Ranma1.&.2". */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return ENTITIES[lower] ?? m;
  });
}

/** Removes a recognized token from a word list, by index. */
function cut<T>(arr: T[], i: number, n = 1): void {
  arr.splice(i, n);
}

/** Parses a release name (or file name) into its parts. Never throws; unknown parts stay null. */
export function parseRelease(input: string): ParsedRelease {
  const out = blank(input);
  let name = decodeEntities(input.trim()).replace(/^.*[\\/]/, ''); // a path: keep the file name
  const ext = EXTENSIONS.exec(name);
  if (ext) {
    out.extension = ext[1]!.toLowerCase();
    name = name.slice(0, ext.index);
  }
  // Dots or underscores as word separators (Scene-style names) become spaces, keeping decimals like 5.1.
  const dotted = !/\s/.test(name) && /[._]/.test(name);
  if (dotted) name = name.replace(/_/g, ' ').replace(/\.(?!\d(?:\b|ch)|26[45]\b)/g, ' ');
  else name = name.replace(/_/g, ' ');

  const { main: rawMain, tags } = extractTags(name);
  // The group is the first bracket at the very start, unless it is plainly metadata.
  const lead = tags[0];
  if (lead && name.slice(0, lead.start).trim() === '' && lead.text && !classify(lead.text, blank(input))) {
    out.group = lead.text;
    tags.shift();
  }
  for (const t of tags) {
    const parts = t.text.split(/[\s,]+|(?<=\S)_(?=\S)/).filter(Boolean);
    const unknown = parts.filter((p) => !classify(p, out));
    // A tag of only unknown words: a multi-word flag ("Dual Audio"), a batch range, or a year range.
    const phrase = t.text.toLowerCase();
    const seasonTag = /^(?:season\s?(\d{1,2})|s(\d{1,2})|(\d{1,2})(?:st|nd|rd|th) season)$/i.exec(t.text);
    if (seasonTag) out.season ??= Number(seasonTag[1] ?? seasonTag[2] ?? seasonTag[3]);
    else if (FLAG_WORDS[phrase]) out.flags.push(FLAG_WORDS[phrase]!);
    else if (unknown.length === parts.length) {
      const range = /^(\d{1,4})\s*(?:-|~|to)\s*(\d{1,4})$/.exec(t.text);
      if (range && out.episode === null) {
        out.episode = Number(range[1]);
        out.episode_to = Number(range[2]);
      }
    }
  }

  let main = rawMain.replace(/\s+/g, ' ').trim();
  // Amazon lists some shows with an "Original Language" marker before the episode: "Saint Tail Original Language S01E40".
  main = main.replace(/\bOriginal[\s._-]+Language\b/gi, ' ').replace(/\s+/g, ' ').trim();
  // Season and episode in one token: S02E05, S2E05v2, S02E01-E12.
  const sxe = /\bS(\d{1,2})\s?E(\d{1,4})(?:v(\d))?(?:\s?-\s?E?(\d{1,4}))?\b/i.exec(main);
  let titleEnd = main.length;
  let markerEnd = main.length;
  // Season and episode joined by a hyphen: "S2-07", "Season 3-13", "2nd-02" (Moozzi2, Erai-raws, Ohys-Raws).
  const sHyphen =
    /(?:\bS|\bSeason[\s.]?)(\d{1,2})-(\d{1,4})(?:v(\d))?(?=\s|$|-[A-Za-z])/i.exec(main) ?? /\b(\d{1,2})(?:st|nd|rd|th)-(\d{1,4})(?:v(\d))?(?=\s|$|-[A-Za-z])/i.exec(main);
  // A season pack with the season glued to the title: "Title-S03".
  const sGlued = /(?<=[^\s-])-S(\d{1,2})(?=\s|$)/i.exec(main);
  if (sxe) {
    out.season = Number(sxe[1]);
    out.episode = Number(sxe[2]);
    if (sxe[3]) out.version = Number(sxe[3]);
    if (sxe[4]) out.episode_to = Number(sxe[4]);
    titleEnd = sxe.index;
    markerEnd = sxe.index + sxe[0].length;
  } else if (sHyphen) {
    out.season = Number(sHyphen[1]);
    out.episode = Number(sHyphen[2]);
    if (sHyphen[3]) out.version = Number(sHyphen[3]);
    titleEnd = sHyphen.index;
    markerEnd = sHyphen.index + sHyphen[0].length;
  } else if (sGlued) {
    out.season = Number(sGlued[1]);
    titleEnd = sGlued.index;
    markerEnd = sGlued.index + sGlued[0].length;
  } else {
    // " - 05", " - 05v2", " - 01-12", " - 01 ~ 12", " - SP2", " - OVA 3": the number after the last " - ".
    const dash = /\s-\s(?:(SP|OVA|OAD|Special|Ep\.?|Episode|E|#)\s?)?(\d{1,4}(?:\.5)?)(?:v(\d))?(?:\s?(?:-|~|to)\s?(\d{1,4})(?:v\d)?)?(?=\s|$)/gi;
    let found: RegExpExecArray | null = null;
    for (const m of main.matchAll(dash)) found = m;
    // Otherwise a marked number anywhere: EP05, E05, Episode 5, #5, or a bare trailing number.
    const marked = /(?:\b(?:EP?\.?|Episode)|#)[\s-]?(\d{1,4})(?:v(\d))?\b/i.exec(main);
    // Chinese fansubs: "第13话" (also 話 and 集) is episode 13.
    const cjk = /第\s?(\d{1,4})\s?[话話集]/.exec(main);
    if (found) {
      const prefix = found[1]?.toLowerCase();
      if (prefix && SPECIAL_WORDS[prefix]) out.special = SPECIAL_WORDS[prefix]!;
      out.episode = Math.floor(Number(found[2]));
      if (found[3]) out.version = Number(found[3]);
      if (found[4]) out.episode_to = Number(found[4]);
      titleEnd = found.index;
      markerEnd = found.index + found[0].length;
    } else if (cjk) {
      out.episode = Number(cjk[1]);
      titleEnd = cjk.index;
      markerEnd = cjk.index + cjk[0].length;
    } else if (marked) {
      out.episode = Number(marked[1]);
      if (marked[2]) out.version = Number(marked[2]);
      titleEnd = marked.index;
      markerEnd = marked.index + marked[0].length;
    } else {
      // "Title -03": the hyphen glued to the episode, with a space before it (Erai-raws, after a year tag).
      const spaced = /\s-(\d{1,4})(?:v(\d))?(?=\s|$)/.exec(main);
      if (spaced && !YEAR.test(spaced[1]!) && Number(spaced[1]) > 0) {
        out.episode = Number(spaced[1]);
        if (spaced[2]) out.version = Number(spaced[2]);
        titleEnd = spaced.index;
        markerEnd = spaced.index + spaced[0].length;
      } else {
        const trailing = /\s(\d{1,4})(?:v(\d))?(?:\s?-\s?(\d{1,4}))?$/.exec(main) ?? /\s(\d{1,4})()(?:\s?-\s?(\d{1,4}))(?=\s+(?:complete|batch)\b)/i.exec(main);
        if (trailing && !(YEAR.test(trailing[1]!) && !trailing[3] && out.year === null && /\(/.test(input))) {
          out.episode = Number(trailing[1]);
          if (trailing[2]) out.version = Number(trailing[2]);
          if (trailing[3]) out.episode_to = Number(trailing[3]);
          titleEnd = trailing.index;
          markerEnd = trailing.index + trailing[0].length;
        } else {
          // Erai-raws and SubsPlease style, "Title.Words-03.[1080p...]" or "Spy x Family-47 [1080p]": the number is
          // glued to the last word by a hyphen, with only tags after it. Never a year, and never a zero ("Gundam-00").
          const glued = /(?<=[^\s-])-(\d{1,4})(?:v(\d))?(?=\s|$|-[A-Za-z]|-$)/.exec(main);
          if (glued && !YEAR.test(glued[1]!) && Number(glued[1]) > 0) {
            out.episode = Number(glued[1]);
            if (glued[2]) out.version = Number(glued[2]);
            titleEnd = glued.index;
            markerEnd = glued.index + glued[0].length;
          }
        }
      }
    }
  }

  // A season pack with tags the title walk below does not know ("Show.S01.2024.1080p.Baha.WEB-DL", "Show S02 Dual Audio"):
  // the season token ends the title when a year, a resolution or "Complete" follows it.
  if (out.episode === null && out.season === null && titleEnd === main.length) {
    const pack = /\sS(\d{1,2})(?=\s(?:(?:19|20)\d\d|\d{3,4}p|complete|dual|batch)\b)/i.exec(main);
    if (pack) {
      out.season = Number(pack[1]);
      titleEnd = pack.index;
      markerEnd = pack.index + pack[0].length;
    }
  }

  // Scene-style metadata outside brackets: after the marker, and at the end of the title.
  // "H264-GRP" ends in the group name.
  const tagWord = (w: string): boolean => {
    if (classify(w, out)) return true;
    const scene = /^(.+)-([A-Za-z0-9]+)$/.exec(w);
    if (scene && classify(scene[1]!, out)) {
      out.group ??= scene[2]!;
      return true;
    }
    return false;
  };
  for (const w of main.slice(markerEnd).split(' ')) tagWord(w);

  // The title is what precedes the episode marker, minus season, part and special tokens.
  const words = main.slice(0, titleEnd).replace(/\s[-:~|]\s*$/, '').trim().split(' ').filter(Boolean);
  while (words.length > 1 && tagWord(words[words.length - 1]!)) words.pop();
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    const lower = w.toLowerCase();
    let m: RegExpExecArray | null;
    if ((m = /^S(\d{1,2})$/i.exec(w)) && i > 0) {
      out.season = Number(m[1]);
      cut(words, i--);
    } else if (/^season$/i.test(w) && next && /^\d{1,2}$/.test(next)) {
      out.season = Number(next);
      cut(words, i--, 2);
    } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)$/i.exec(w)) && next && /^season$/i.test(next)) {
      out.season = ordinal(m[1]!);
      cut(words, i--, 2);
    } else if (/^(?:part|cour)$/i.test(w) && next && (/^\d{1,2}$/.test(next) || ROMAN[next.toLowerCase()])) {
      out.part = /^\d+$/.test(next) ? Number(next) : ROMAN[next.toLowerCase()]!;
      cut(words, i--, 2);
    } else if (i === words.length - 1 && i > 0 && out.season === null && /^(?:ii|iii|iv)$/i.test(w)) {
      out.season = ROMAN[lower]!;
      cut(words, i--);
    } else if (SPECIAL_WORDS[lower] && i > 0 && out.special === null) {
      // Kept in the title: many titles contain the word ("... Movie: Code: White"); resolve retries without it.
      out.special = SPECIAL_WORDS[lower]!;
    } else if (YEAR.test(w) && i > 0 && out.year === null && i === words.length - 1) {
      out.year = Number(w);
      cut(words, i--);
    } else if (FLAG_WORDS[lower] && i === words.length - 1 && i > 0) {
      out.flags.push(FLAG_WORDS[lower]!);
      cut(words, i--);
    }
  }
  let title = words.join(' ').replace(/[\s\-:~|]+$/, '').replace(/^[\s\-:~|]+/, '').trim();
  // "Iczer One 1985 OVA": a year and a special marker at the end of a release with no episode.
  if (out.episode === null && out.season === null && out.year === null && words.length > 2) {
    const last = words[words.length - 1]!;
    const prev = words[words.length - 2]!;
    const special = SPECIAL_WORDS[last.toLowerCase()];
    if (YEAR.test(prev) && special) {
      out.year = Number(prev);
      out.special ??= special;
      words.splice(-2);
      title = words.join(' ').replace(/[\s\-:~|]+$/, '').replace(/^[\s\-:~|]+/, '').trim();
    }
  }
  // Scene-style "Title.Words.35.BD.Remux.1080p...": the episode sits between the title and the tags, so it
  // was not the trailing number when the marker was searched. Never a year, a zero ("Gundam 00") or a season.
  if (dotted && out.episode === null && out.season === null && out.part === null) {
    const bare = /^(.+\s)(\d{1,3})$/.exec(title);
    if (bare && Number(bare[2]) > 0) {
      out.episode = Number(bare[2]);
      title = bare[1]!.trim();
    }
  }
  out.title = title || null;

  out.flags = [...new Set(out.flags)];
  out.audio = [...new Set(out.audio)];
  // "Show.S01.1080p..." and "Show Season 2 [BD]": a season with no episode is a season pack.
  if (out.season !== null && out.episode === null && out.special === null && !out.flags.includes('batch')) out.flags.push('batch');
  out.batch = out.flags.includes('batch') || (out.episode !== null && out.episode_to !== null && out.episode_to > out.episode);
  if (out.batch && !out.flags.includes('batch')) out.flags.push('batch');
  if (out.episode_to !== null && out.episode !== null && out.episode_to <= out.episode) out.episode_to = null;
  return out;
}
