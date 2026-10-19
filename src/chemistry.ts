import { cleanText, diagnose, validChecksum } from './core/engine.js';

export type Finding = { category: 'error' | 'warning' | 'automatic_fix' | 'unverifiable'; code: string; message: string };
export const finding = (category: Finding['category'], code: string, message: string): Finding => ({ category, code, message });

export function checkCas(original: string, applyFixes = false) {
  const d = diagnose(original);
  const value = applyFixes && d.status === 'fixable' ? d.suggestion ?? original : original;
  const findings: Finding[] = d.issues.filter(i => i !== 'VALID').map(code => finding(
    value !== original ? 'automatic_fix' : d.status === 'invalid' || d.status === 'empty' ? 'error' : 'warning',
    code, `CAS diagnostic: ${code.toLowerCase()}.`,
  ));
  findings.push(finding('unverifiable', 'CAS_IDENTITY_UNVERIFIED', 'Format and checksum do not verify registration or substance identity.'));
  return { original, value, valid: ['healthy', 'fixable'].includes(d.status) && validChecksum(d.suggestion ?? original), status: d.status, suggestion: d.suggestion, findings };
}

export function normalizeName(original: string, applyFixes = true) {
  const suggestion = cleanText(original);
  const value = applyFixes ? suggestion : original;
  const findings: Finding[] = [finding('unverifiable', 'NAME_IDENTITY_UNVERIFIED', 'No synonym resolution, translation, systematic naming or identity verification is performed.')];
  if (!suggestion) findings.push(finding('warning', 'EMPTY_NAME', 'Name is empty.'));
  if (suggestion !== original) findings.push(finding(applyFixes ? 'automatic_fix' : 'warning', 'NAME_WHITESPACE', 'Whitespace and invisible characters can be normalized.'));
  return { original, value, suggestion, findings };
}

// All 118 current element symbols. No chemical database or proprietary data.
const elements = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '));

/** Restricted grammar: element counts, nested ()/[], hydrate separators and coefficients. */
export function checkFormula(original: string) {
  const findings: Finding[] = [finding('unverifiable', 'FORMULA_PLAUSIBILITY_UNVERIFIED', 'Syntax does not establish chemical plausibility, structure or substance identity.')];
  const result = (status: 'valid_syntax' | 'invalid' | 'unverifiable', atoms: Record<string, number> = {}) => ({ original, status, atoms, findings });
  if (!original) {
    findings.push(finding('error', 'EMPTY_FORMULA', 'Formula is empty.'));
    return result('invalid');
  }
  if (original.length > 256 || /[\s+\-^{}₀-₉]/u.test(original) || /\[\d+[A-Z]/.test(original) || /^[a-z]/.test(original) || /R(?![a-z])|(?<![A-Z])[nx]/.test(original)) {
    findings.push(finding('unverifiable', 'UNSUPPORTED_NOTATION', 'Charges, isotopes, variables, whitespace, subscripts and long formulas require manual review.'));
    return result('unverifiable');
  }
  try {
    let pos = 0;
    const fail = () => { throw new Error('Invalid formula grammar, element, count or nesting.'); };
    const count = () => {
      const start = pos;
      while (/\d/.test(original[pos] ?? '') && pos < original.length) pos++;
      if (start === pos) return 1;
      const token = original.slice(start, pos);
      const value = Number(token);
      if (token.startsWith('0') || value > 1_000_000) fail();
      return value;
    };
    const add = (target: Record<string, number>, source: Record<string, number>, multiplier: number) => {
      for (const [symbol, n] of Object.entries(source)) {
        target[symbol] = (target[symbol] ?? 0) + n * multiplier;
        if (target[symbol] > 1_000_000_000) fail();
      }
    };
    const group = (depth: number, closing = ''): Record<string, number> => {
      if (depth > 16) fail();
      const atoms: Record<string, number> = {};
      let units = 0;
      while (pos < original.length && !'.·'.includes(original[pos]) && original[pos] !== closing) {
        const ch = original[pos];
        if (ch === '(' || ch === '[') {
          pos++;
          const inner = group(depth + 1, ch === '(' ? ')' : ']');
          if (original[pos] !== (ch === '(' ? ')' : ']')) fail();
          pos++;
          add(atoms, inner, count());
        } else {
          if (!/[A-Z]/.test(ch)) fail();
          let symbol = original[pos++];
          if (pos < original.length && /[a-z]/.test(original[pos])) symbol += original[pos++];
          if (!elements.has(symbol)) fail();
          add(atoms, { [symbol]: 1 }, count());
        }
        units++;
      }
      if (!units) fail();
      return atoms;
    };
    const atoms: Record<string, number> = {};
    while (pos < original.length) {
      const coefficient = count();
      add(atoms, group(0), coefficient);
      if (pos === original.length) break;
      if (!'.·'.includes(original[pos++]) || pos === original.length) fail();
    }
    return result('valid_syntax', atoms);
  } catch {
    findings.push(finding('error', 'FORMULA_SYNTAX', 'Invalid element symbol, brackets, count, nesting or hydrate syntax.'));
    return result('invalid');
  }
}

export function duplicates(values: string[]) {
  const seen = new Map<string, number>();
  const matches: { index: number; duplicateOf: number; key: string }[] = [];
  values.forEach((value, index) => {
    const d = diagnose(value);
    const key = d.status === 'fixable' ? d.suggestion ?? value : value;
    if (!key.trim()) return;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else matches.push({ index, duplicateOf: first, key });
  });
  return { total: values.length, duplicates: matches, findings: matches.length ? [finding('warning', 'DUPLICATE', 'Repeated normalized identifiers are retained; identity is not inferred.')] : [] };
}
