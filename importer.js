(() => {
  'use strict';

  const FIELD_DEFS = [
    { key: 'id', label: '编号', aliases: ['id','编号','序号','任务编号','邮件编号','rowid','taskid'] },
    { key: 'recipients', label: '收件人', aliases: ['收件人','收件邮箱','收件人邮箱','邮箱','邮箱地址','邮件地址','email','emailaddress','recipient','recipients','to','toemail'] },
    { key: 'subject', label: '主题', aliases: ['主题','邮件主题','标题','subject','title','emailsubject'] },
    { key: 'body', label: '正文', aliases: ['正文','邮件正文','内容','邮件内容','正文内容','body','content','message','text','emailbody'] },
    { key: 'attachments', label: '附件', aliases: ['附件','附件名','附件名称','附件路径','附件文件','附件列表','attachment','attachments','file','files','filename','filenames','filepath'] },
    { key: 'scheduleAt', label: '定时时间', aliases: ['定时时间','定时发送时间','发送时间','计划发送时间','预约发送时间','schedule','scheduleat','scheduledat','sendat','sendtime','scheduledtime'] },
    { key: 'scheduleEnabled', label: '是否定时', aliases: ['是否定时','定时发送','启用定时','scheduleenabled','scheduled','timer'] },
    { key: 'tags', label: '任务分类', aliases: ['标签','邮件标签','联系人标签','任务标签','批次','分组','类别','分类','tag','tags','label','labels','group','batch','category'] }
  ];

  function normalizeHeader(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s\u00a0\u200b\u200c\u200d\ufeff_\-—–:：()（）\[\]【】<>《》\/\\.]+/g, '')
      .replace(/[?？!！,，;；]/g, '');
  }

  const ALIAS_LOOKUP = (() => {
    const map = new Map();
    for (const field of FIELD_DEFS) {
      for (const alias of field.aliases) map.set(normalizeHeader(alias), field.key);
    }
    return map;
  })();

  function matchHeader(value) {
    const h = normalizeHeader(value);
    if (!h) return null;
    const exact = ALIAS_LOOKUP.get(h);
    if (exact) return { field: exact, score: 100 };

    let best = null;
    for (const def of FIELD_DEFS) {
      for (const aliasRaw of def.aliases) {
        const alias = normalizeHeader(aliasRaw);
        if (alias.length < 2) continue;
        let score = 0;
        if (h.includes(alias)) score = 72 + Math.min(alias.length, 20);
        else if (alias.includes(h) && h.length >= 3) score = 55 + Math.min(h.length, 20);
        if (score && (!best || score > best.score)) best = { field: def.key, score };
      }
    }
    return best;
  }

  function mappingForHeaders(headers) {
    const candidates = [];
    headers.forEach((header, index) => {
      const match = matchHeader(header);
      if (match) candidates.push({ ...match, index });
    });
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);

    const usedFields = new Set();
    const usedColumns = new Set();
    const mapping = {};
    for (const item of candidates) {
      if (usedFields.has(item.field) || usedColumns.has(item.index)) continue;
      mapping[item.field] = item.index;
      usedFields.add(item.field);
      usedColumns.add(item.index);
    }
    return mapping;
  }

  function detectHeader(rows) {
    const limit = Math.min(rows.length, 20);
    let best = null;
    for (let i = 0; i < limit; i++) {
      const row = rows[i] || [];
      const headers = row.map(v => String(v ?? '').trim());
      const mapping = mappingForHeaders(headers);
      const recognized = Object.keys(mapping).length;
      const core = ['recipients','subject','body','attachments','scheduleAt'].filter(k => mapping[k] != null).length;
      const nonEmpty = headers.filter(Boolean).length;
      const score = recognized * 1000 + core * 250 + Math.min(nonEmpty, 30) - i * 5;
      if (!best || score > best.score) best = { index: i, headers, mapping, recognized, core, score };
    }

    if (!best) return { index: 0, headers: [], mapping: {}, recognized: 0, core: 0, score: 0 };
    if (best.recognized === 0) {
      const fallbackIndex = rows.findIndex(row => (row || []).some(v => String(v ?? '').trim()));
      const index = fallbackIndex >= 0 ? fallbackIndex : 0;
      const headers = (rows[index] || []).map((v, col) => String(v ?? '').trim() || `列${col + 1}`);
      return { index, headers, mapping: {}, recognized: 0, core: 0, score: 0 };
    }
    best.headers = best.headers.map((v, col) => v || `列${col + 1}`);
    return best;
  }

  function detectBestSheet(sheets) {
    let best = null;
    sheets.forEach((sheet, index) => {
      const detection = detectHeader(sheet.rows || []);
      const dataRows = Math.max(0, (sheet.rows || []).length - detection.index - 1);
      const score = detection.score + Math.min(dataRows, 500);
      if (!best || score > best.score) best = { index, detection, score };
    });
    return best || { index: 0, detection: detectHeader([]), score: 0 };
  }

  function decodeText(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\ufeff/, '');
    } catch (_) {
      try { return new TextDecoder('gb18030').decode(bytes).replace(/^\ufeff/, ''); }
      catch (_) { return new TextDecoder().decode(bytes).replace(/^\ufeff/, ''); }
    }
  }

  function countDelimiter(line, delimiter) {
    let count = 0;
    let quote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quote && line[i + 1] === '"') i++;
        else quote = !quote;
      } else if (!quote && ch === delimiter) count++;
    }
    return count;
  }

  function detectDelimiter(text, preferred = null) {
    if (preferred) return preferred;
    const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 8);
    const choices = [',', '\t', ';'];
    let best = { delimiter: ',', score: -1 };
    for (const delimiter of choices) {
      const counts = lines.map(line => countDelimiter(line, delimiter));
      const score = counts.reduce((a, b) => a + b, 0) + (counts.filter(Boolean).length * 3);
      if (score > best.score) best = { delimiter, score };
    }
    return best.delimiter;
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every(v => !String(v).trim())) rows.pop();
    return rows;
  }

  function objectArrayToRows(items) {
    const headers = [];
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      for (const key of Object.keys(item)) if (!seen.has(key)) { seen.add(key); headers.push(key); }
    }
    return [headers, ...items.map(item => headers.map(key => {
      const value = item?.[key];
      if (Array.isArray(value)) return value.join(';');
      if (value && typeof value === 'object') return JSON.stringify(value);
      return value ?? '';
    }))];
  }

  function parseJson(text) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      if (!data.length) return [[]];
      if (Array.isArray(data[0])) return data;
      return objectArrayToRows(data);
    }
    if (data && typeof data === 'object') {
      const arrays = Object.entries(data).filter(([, value]) => Array.isArray(value));
      if (Array.isArray(data.data)) return Array.isArray(data.data[0]) ? data.data : objectArrayToRows(data.data);
      if (arrays.length) {
        const value = arrays[0][1];
        return Array.isArray(value[0]) ? value : objectArrayToRows(value);
      }
      return objectArrayToRows([data]);
    }
    throw new Error('JSON 顶层必须是数组或对象。');
  }

  function findEocd(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new Error('不是有效的 XLSX/ZIP 文件：未找到 ZIP 目录。');
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('当前 Chrome 不支持 XLSX 解压，请改用 CSV/TSV/JSON。');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const eocd = findEocd(view);
    const total = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder('utf-8');

    for (let idx = 0; idx < total; idx++) {
      if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('XLSX ZIP 中央目录损坏。');
      const method = view.getUint16(pos + 10, true);
      const compressedSize = view.getUint32(pos + 20, true);
      const fileNameLength = view.getUint16(pos + 28, true);
      const extraLength = view.getUint16(pos + 30, true);
      const commentLength = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);
      const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + fileNameLength));

      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`XLSX ZIP 项损坏：${name}`);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      let output;
      if (method === 0) output = compressed;
      else if (method === 8) output = await inflateRaw(compressed);
      else throw new Error(`XLSX 使用了暂不支持的 ZIP 压缩方式：${method}`);
      entries.set(name.replace(/^\//, ''), output);
      pos += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
  }

  function xml(entries, path, required = true) {
    const bytes = entries.get(path.replace(/^\//, ''));
    if (!bytes) {
      if (!required) return null;
      throw new Error(`XLSX 缺少文件：${path}`);
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(`XLSX XML 无法解析：${path}`);
    return doc;
  }

  function columnIndex(cellRef) {
    const letters = String(cellRef || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return Math.max(0, n - 1);
  }

  // OOXML is namespace-qualified. Excel/WPS/other writers may emit either
  // <sheet> or <x:sheet> (and likewise row/c/v/t). Looking up only the
  // literal tag name silently returns zero nodes for prefixed documents.
  // Always resolve elements by localName so both forms work.
  function elementsByLocalName(root, localName) {
    if (!root) return [];
    try {
      if (typeof root.getElementsByTagNameNS === 'function') {
        const nodes = root.getElementsByTagNameNS('*', localName);
        if (nodes?.length) return Array.from(nodes);
      }
    } catch (_) {}

    try {
      return Array.from(root.getElementsByTagName('*') || []).filter(el => {
        const tag = String(el.localName || el.tagName || '');
        return tag === localName || tag.endsWith(`:${localName}`);
      });
    } catch (_) {
      return [];
    }
  }

  function firstByLocalName(root, localName) {
    return elementsByLocalName(root, localName)[0] || null;
  }

  function parseSharedStrings(doc) {
    if (!doc) return [];
    return elementsByLocalName(doc, 'si').map(si =>
      elementsByLocalName(si, 't').map(t => t.textContent || '').join('')
    );
  }

  function parseWorksheet(doc, sharedStrings) {
    const rows = [];
    for (const rowEl of elementsByLocalName(doc, 'row')) {
      const rowNumber = Number(rowEl.getAttribute('r')) || rows.length + 1;
      const row = [];
      for (const c of elementsByLocalName(rowEl, 'c')) {
        const col = columnIndex(c.getAttribute('r'));
        const type = c.getAttribute('t') || '';
        const v = firstByLocalName(c, 'v')?.textContent ?? '';
        let value = v;
        if (type === 's') value = sharedStrings[Number(v)] ?? '';
        else if (type === 'inlineStr') value = elementsByLocalName(c, 't').map(t => t.textContent || '').join('');
        else if (type === 'b') value = v === '1';
        else if (type === 'n' || !type) {
          const num = Number(v);
          value = v !== '' && Number.isFinite(num) ? num : v;
        }
        row[col] = value;
      }
      while (rows.length < rowNumber - 1) rows.push([]);
      rows[rowNumber - 1] = row;
    }
    while (rows.length && !(rows[rows.length - 1] || []).some(v => String(v ?? '').trim())) rows.pop();
    return rows;
  }

  function resolveTarget(base, target) {
    if (String(target || '').startsWith('/')) return String(target).replace(/^\/+/, '');
    const parts = base.split('/');
    parts.pop();
    for (const part of String(target || '').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  async function parseXlsx(buffer) {
    const entries = await unzip(buffer);
    const workbook = xml(entries, 'xl/workbook.xml');
    const rels = xml(entries, 'xl/_rels/workbook.xml.rels');
    const shared = parseSharedStrings(xml(entries, 'xl/sharedStrings.xml', false));
    const relMap = new Map();
    for (const rel of elementsByLocalName(rels, 'Relationship')) relMap.set(rel.getAttribute('Id'), rel.getAttribute('Target'));

    const sheets = [];
    for (const sheetEl of elementsByLocalName(workbook, 'sheet')) {
      const name = sheetEl.getAttribute('name') || `Sheet${sheets.length + 1}`;
      const rid = sheetEl.getAttribute('r:id') || sheetEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const target = relMap.get(rid);
      if (!target) continue;
      const path = resolveTarget('xl/workbook.xml', target);
      const ws = xml(entries, path);
      sheets.push({ name, rows: parseWorksheet(ws, shared) });
    }
    if (!sheets.length) {
      const sheetCount = elementsByLocalName(workbook, 'sheet').length;
      const relCount = elementsByLocalName(rels, 'Relationship').length;
      throw new Error(`XLSX 中没有可读取的工作表（workbook sheets=${sheetCount}, relationships=${relCount}）。`);
    }
    return { sheets };
  }

  async function parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const buffer = await file.arrayBuffer();
    if (ext === 'xlsx') return parseXlsx(buffer);
    if (ext === 'xls') throw new Error('暂不直接读取旧版 .xls，请在 Excel/WPS 中另存为 .xlsx 或 CSV 后导入。');
    const text = decodeText(buffer);
    if (ext === 'json') return { sheets: [{ name: 'JSON', rows: parseJson(text) }] };
    if (ext === 'tsv') return { sheets: [{ name: 'TSV', rows: parseDelimited(text, '\t') }] };
    if (ext === 'csv' || ext === 'txt') return { sheets: [{ name: ext.toUpperCase(), rows: parseDelimited(text, detectDelimiter(text, ext === 'tsv' ? '\t' : null)) }] };
    throw new Error('支持的导入格式：.xlsx、.csv、.tsv、.json。');
  }

  function excelSerialToDate(serial) {
    const n = Number(serial);
    if (!Number.isFinite(n)) return null;
    const utc = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(utc);
    return Number.isNaN(d.getTime()) ? null : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  }

  function parseDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && value > 1000 && value < 100000) return excelSerialToDate(value);
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const num = Number(raw);
      if (num > 1000 && num < 100000) return excelSerialToDate(num);
    }
    const normalized = raw
      .replace(/[年\/\.]/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
      if (!Number.isNaN(d.getTime())) return d;
    }
    const native = new Date(raw);
    return Number.isNaN(native.getTime()) ? null : native;
  }

  function formatLocalDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = normalizeHeader(value);
    if (!s) return null;
    if (['1','true','yes','y','是','启用','开启','定时'].includes(s)) return true;
    if (['0','false','no','n','否','关闭','不定时'].includes(s)) return false;
    return null;
  }

  function splitAttachments(value) {
    return String(value ?? '')
      .split(/[;；|\n]+/)
      .map(v => v.trim())
      .filter(Boolean);
  }

  function normalizeFileKey(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .replace(/\/{2,}/g, '/')
      .toLowerCase();
  }

  function baseName(value) {
    const key = normalizeFileKey(value);
    return key.split('/').filter(Boolean).pop() || '';
  }

  // Chrome/Windows 下载重复文件时经常自动出现 “(1)” / “（2）”。
  // 只把它作为低一级候选，不会覆盖真正的精确匹配。
  function relaxedFileName(value) {
    const name = baseName(value);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return `${stem.replace(/\s*[（(]\d+[）)]\s*$/, '').trim()}${ext}`;
  }

  function fileIdentity(file) {
    return `${normalizeFileKey(file?.webkitRelativePath || file?.name)}|${Number(file?.size || 0)}|${Number(file?.lastModified || 0)}`;
  }

  function addIndex(map, key, file) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.some(item => fileIdentity(item) === fileIdentity(file))) list.push(file);
  }

  function buildFileIndex(files) {
    const exact = new Map();
    const byName = new Map();
    const relaxedByName = new Map();
    const unique = new Map();
    for (const file of files || []) {
      if (!file) continue;
      unique.set(fileIdentity(file), file);
      const relative = normalizeFileKey(file.webkitRelativePath || '');
      const relativeWithoutRoot = relative.includes('/') ? relative.split('/').slice(1).join('/') : '';
      const paths = [file.name, relative, relativeWithoutRoot].filter(Boolean).map(normalizeFileKey);
      for (const path of paths) addIndex(exact, path, file);
      const name = baseName(file.name);
      addIndex(byName, name, file);
      addIndex(relaxedByName, relaxedFileName(name), file);
    }
    return { exact, byName, relaxedByName, files: [...unique.values()] };
  }

  function resolveOneFile(ref, index) {
    const key = normalizeFileKey(ref);
    if (!key) return { ref, status: 'missing', candidates: [], method: 'empty' };
    let matches = index?.exact?.get(key) || [];
    if (matches.length === 1) return { ref, status: 'matched', file: matches[0], candidates: matches, method: 'exact' };
    if (matches.length > 1) return { ref, status: 'ambiguous', candidates: matches, method: 'exact' };

    const basename = baseName(key);
    matches = index?.byName?.get(basename) || [];
    if (matches.length === 1) return { ref, status: 'matched', file: matches[0], candidates: matches, method: 'basename' };
    if (matches.length > 1) return { ref, status: 'ambiguous', candidates: matches, method: 'basename' };

    const relaxed = relaxedFileName(basename);
    matches = index?.relaxedByName?.get(relaxed) || [];
    if (matches.length === 1) return { ref, status: 'matched', file: matches[0], candidates: matches, method: 'relaxed-copy-suffix' };
    if (matches.length > 1) return { ref, status: 'ambiguous', candidates: matches, method: 'relaxed-copy-suffix' };
    return { ref, status: 'missing', candidates: [], method: 'none' };
  }

  function candidateScore(ref, file) {
    const wanted = baseName(ref);
    const actual = baseName(file?.name);
    if (!wanted || !actual) return 0;
    if (wanted === actual) return 100;
    if (relaxedFileName(wanted) === relaxedFileName(actual)) return 90;
    const wStem = wanted.replace(/\.[^.]+$/, '');
    const aStem = actual.replace(/\.[^.]+$/, '');
    if (wStem && aStem && (wStem.includes(aStem) || aStem.includes(wStem))) return 65;
    const tokens = new Set(wStem.split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1));
    const other = new Set(aStem.split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1));
    let overlap = 0;
    for (const token of tokens) if (other.has(token)) overlap++;
    return overlap ? 30 + Math.min(30, overlap * 10) : 0;
  }

  function suggestFiles(ref, index, limit = 12) {
    return [...(index?.files || [])]
      .map(file => ({ file, score: candidateScore(ref, file) }))
      .sort((a, b) => b.score - a.score || String(a.file.name).localeCompare(String(b.file.name)))
      .slice(0, Math.max(1, limit));
  }

  function resolveFiles(refs, index) {
    const files = [];
    const missing = [];
    const ambiguous = [];
    const details = [];
    for (const ref of refs || []) {
      const detail = resolveOneFile(ref, index || buildFileIndex([]));
      details.push(detail);
      if (detail.status === 'matched') files.push(detail.file);
      else if (detail.status === 'missing') missing.push(ref);
      else ambiguous.push(ref);
    }
    return { files, missing, ambiguous, details };
  }

  globalThis.NMDAImporter = {
    FIELD_DEFS,
    normalizeHeader,
    mappingForHeaders,
    detectHeader,
    detectBestSheet,
    parseFile,
    parseDateValue,
    formatLocalDateTime,
    parseBoolean,
    splitAttachments,
    normalizeFileKey,
    relaxedFileName,
    fileIdentity,
    buildFileIndex,
    resolveOneFile,
    suggestFiles,
    resolveFiles
  };
})();
