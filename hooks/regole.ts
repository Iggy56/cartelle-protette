// Le regole della guardia, senza il motore: dato un comando, la cartella da cui parte e
// le cartelle protette, dicono se tocca una cartella protetta e come. Il motore
// (register.ts) passa i percorsi veri, con i collegamenti seguiti, e il testo dei
// programmi che il comando lancia.

export const NOME = 'cartelle-protette'

export type Cartella = {
  /** Come l'ha scritta la persona: è il nome che compare nei messaggi. */
  scritta: string
  /** Le forme assolute, minuscole: come scritta e dove porta davvero. */
  percorsi: string[]
  /** Come può comparire nel testo di un comando: assoluta, con ~ e con $HOME. */
  testi: string[]
}

export type Tocco =
  | { come: 'scrive' | 'contiene' | 'programma'; cartella: Cartella }
  | { come: 'impostazioni' }

export type Ambiente = {
  cwd: string
  casa: string
  cartelle: readonly Cartella[]
  /** Dove porta davvero un percorso; senza file system, il percorso stesso. */
  reale?: (percorso: string) => Promise<string>
  /** Il testo di un programma che il comando lancia, se si può leggere. */
  leggi?: (percorso: string) => Promise<string | undefined>
}

// I comandi che leggono soltanto.
export const LETTURA = ['ls', 'cat', 'head', 'tail', 'grep', 'find', 'stat', 'du', 'wc', 'echo']
const LEGGE = new Set(LETTURA)
// Le opzioni di find che cancellano, lanciano altri comandi o scrivono file.
const FIND_SCRIVE = /^-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/
// I comandi che agiscono su una cartella con tutto quello che contiene.
const SU_TUTTO = new Set(['rm', 'rmdir', 'mv', 'trash', 'rsync', 'shred', 'srm', 'unlink', 'chmod', 'chown', 'chflags'])
// I programmi che eseguono un file: la guardia legge il file prima che parta.
const INTERPRETI = new Set(['python', 'python3', 'node', 'bash', 'sh', 'zsh', 'ruby', 'perl', 'php', 'deno', 'bun', 'tsx'])
const PROGRAMMA = /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|php)$/i
const IMPOSTAZIONI = /\/\.claude\/settings(?:\.local)?\.json$/

/** Toglie ".", ".." e le barre doppie da un percorso assoluto. */
export function normalizza(percorso: string): string {
  const parti: string[] = []
  for (const parte of percorso.split('/')) {
    if (parte === '' || parte === '.') continue
    if (parte === '..') parti.pop()
    else parti.push(parte)
  }
  return `/${parti.join('/')}`
}

/** Un percorso come compare in un comando, reso assoluto: ~ e $HOME diventano la casa. */
export function assoluto(parola: string, cwd: string, casa: string): string {
  let p = parola
  if (p === '~' || p.startsWith('~/')) p = casa + p.slice(1)
  p = p.replace(/^\$(?:HOME|\{HOME\})(?=\/|$)/, casa)
  return normalizza(p.startsWith('/') ? p : `${cwd}/${p}`)
}

/** Se `percorso` è `radice` o sta sotto di lei, senza badare alle maiuscole (come il Mac). */
export function dentro(percorso: string, radice: string): boolean {
  const p = percorso.toLowerCase()
  const r = radice.toLowerCase()
  return r === '/' || p === r || p.startsWith(`${r}/`)
}

/** Se il testo nomina la forma, e non un nome che la contiene (~/App non è ~/Applications). */
export function nomina(testo: string, forma: string): boolean {
  for (let i = testo.indexOf(forma); i >= 0; i = testo.indexOf(forma, i + 1)) {
    const dopo = testo[i + forma.length]
    if (dopo === undefined || !/[a-z0-9_.-]/.test(dopo)) return true
  }
  return false
}

/** Le forme con cui un percorso può comparire nel testo di un comando. */
export function testiDi(percorsi: readonly string[], casa: string): string[] {
  const testi = new Set<string>()
  for (const p of percorsi.map(x => x.toLowerCase())) {
    testi.add(p)
    if (casa !== '' && dentro(p, casa) && p !== casa.toLowerCase()) {
      const resto = p.slice(casa.length)
      for (const inizio of ['~', '$home', '${home}']) testi.add(inizio + resto)
    }
  }
  return [...testi]
}

/** Le cartelle dell'elenco, come le ha scritte la persona: una per voce, anche separate da a capo o ;. */
export function elenco(valore: unknown): string[] {
  const voci = Array.isArray(valore) ? valore : typeof valore === 'string' ? [valore] : []
  return voci
    .flatMap(v => (typeof v === 'string' ? v.split(/[\n;]/) : []))
    .map(v => v.trim().replace(/(.)\/+$/, '$1'))
    .filter(v => v !== '')
}

type Pezzo = { parole: string[]; redirezioni: string[] }

/**
 * Spezza un comando come fa la shell: in pezzi fra ; && || | & e a capo, ogni pezzo
 * in parole con le virgolette tolte, e a parte i file verso cui scrive con > e >>.
 */
export function pezzi(comando: string): Pezzo[] {
  const fuori: Pezzo[] = []
  let parole: string[] = []
  let redirezioni: string[] = []
  let parola = ''
  let iniziata = false
  let versoFile = false
  let virgolette: '"' | "'" | null = null

  const chiudiParola = () => {
    if (iniziata) {
      ;(versoFile ? redirezioni : parole).push(parola)
      versoFile = false
    }
    parola = ''
    iniziata = false
  }
  const chiudiPezzo = () => {
    chiudiParola()
    if (parole.length > 0 || redirezioni.length > 0) fuori.push({ parole, redirezioni })
    parole = []
    redirezioni = []
    versoFile = false
  }

  for (let i = 0; i < comando.length; i++) {
    const c = comando[i]!
    if (virgolette !== null) {
      if (c === virgolette) virgolette = null
      else if (c === '\\' && virgolette === '"' && i + 1 < comando.length) parola += comando[++i]
      else parola += c
      continue
    }
    if (c === "'" || c === '"') {
      virgolette = c
      iniziata = true
    } else if (c === '\\') {
      if (comando[i + 1] === '\n') i++
      else if (i + 1 < comando.length) {
        parola += comando[++i]
        iniziata = true
      }
    } else if (c === '>' || (c === '&' && comando[i + 1] === '>')) {
      // 2>, >>, &>, >| : il numero davanti è il canale, non una parola.
      if (/^\d+$/.test(parola)) {
        parola = ''
        iniziata = false
      }
      chiudiParola()
      if (c === '&') i++
      while (comando[i + 1] === '>' || comando[i + 1] === '|') i++
      if (comando[i + 1] === '&') {
        // >&2 copia un canale e non scrive file.
        i++
        while (/\d/.test(comando[i + 1] ?? '')) i++
      } else versoFile = true
    } else if (c === ' ' || c === '\t') chiudiParola()
    else if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') chiudiPezzo()
    else {
      parola += c
      iniziata = true
    }
  }
  chiudiPezzo()
  return fuori
}

// Gli argomenti che possono essere percorsi: le opzioni no, ma il valore dopo = sì; di un
// percorso con * o ? conta la cartella dove cerca.
function argomenti(resto: readonly string[]): string[] {
  const fuori: string[] = []
  for (const parola of resto) {
    let p = parola
    if (p.startsWith('-')) {
      if (!p.includes('=')) continue
      p = p.slice(p.indexOf('=') + 1)
    }
    const jolly = p.search(/[*?[{]/)
    if (jolly >= 0) p = p.slice(0, p.lastIndexOf('/', jolly) + 1)
    fuori.push(p === '' ? '.' : p)
  }
  return fuori
}

// Le parole di un pezzo che possono essere percorsi: gli argomenti, e il comando stesso
// quando è un percorso (./pulizia.sh).
function percorsiDi(parole: readonly string[]): string[] {
  const [primo = '', ...resto] = parole
  return [...(primo.includes('/') ? [primo] : []), ...argomenti(resto)]
}

// I percorsi su cui un comando agisce con tutto il contenuto: per mv e rsync la
// destinazione no, ci finisce solo dentro (rsync --delete invece la svuota).
function suTutto(parole: readonly string[]): string[] {
  const [primo = '', ...resto] = parole
  if (primo === 'git') return resto.includes('clean') ? ['.'] : []
  if (primo === 'find') return resto.some(w => FIND_SCRIVE.test(w)) ? argomenti(resto) : []
  if (!SU_TUTTO.has(primo)) return []
  const percorsi = argomenti(resto)
  const tieneDestinazione = primo === 'mv' || (primo === 'rsync' && !resto.includes('--delete'))
  return tieneDestinazione ? percorsi.slice(0, -1) : percorsi
}

// Il file che il pezzo esegue: python3 x.py, bash x.sh, ./x.sh.
function programmaDi(parole: readonly string[]): string | undefined {
  const [primo = '', ...resto] = parole
  if (INTERPRETI.has(primo)) return resto.find(w => !w.startsWith('-'))
  return primo.includes('/') || PROGRAMMA.test(primo) ? primo : undefined
}

/** Il primo modo in cui il comando tocca una cartella protetta, o le impostazioni della guardia. */
export async function esamina(comando: string, amb: Ambiente): Promise<Tocco | undefined> {
  const reale = amb.reale ?? (async (p: string) => p)
  const sottocomandi = /\$\(|`|<\(|>\(/.test(comando)
  const lungo = (p: string) => reale(assoluto(p, dove, amb.casa))
  const sotto = (p: string) => amb.cartelle.find(c => c.percorsi.some(r => dentro(p, r)))
  let dove = amb.cwd

  for (const pezzo of pezzi(comando)) {
    const [primo = '', ...resto] = pezzo.parole
    const versoFile = (await Promise.all(pezzo.redirezioni.map(lungo))).filter(p => p !== '/dev/null')
    const percorsi = await Promise.all(percorsiDi(pezzo.parole).map(lungo))
    const legge = !sottocomandi && LEGGE.has(primo) && !(primo === 'find' && resto.some(w => FIND_SCRIVE.test(w)))

    // Le impostazioni di Claude Code scritte dal terminale: la guardia si spegnerebbe lì.
    // git no: aggiungerle a un commit non le cambia.
    const impostazioni = (p: string) => IMPOSTAZIONI.test(p)
    if (versoFile.some(impostazioni) || (!legge && primo !== 'git' && percorsi.some(impostazioni))) {
      return { come: 'impostazioni' }
    }

    // Un comando che legge può scrivere quello che legge in un file fuori, non dentro.
    const scrittaDentro = versoFile.map(sotto).find(c => c !== undefined)
    if (scrittaDentro) return { come: 'scrive', cartella: scrittaDentro }

    const testo = [...pezzo.parole, ...pezzo.redirezioni].join(' ').toLowerCase()
    const toccata =
      amb.cartelle.find(c => c.testi.some(t => nomina(testo, t))) ??
      sotto(dove) ??
      percorsi.map(sotto).find(c => c !== undefined)
    if (toccata && !legge) return { come: 'scrive', cartella: toccata }

    for (const p of await Promise.all(suTutto(pezzo.parole).map(lungo))) {
      const contenuta = amb.cartelle.find(c => c.percorsi.some(r => dentro(r, p)))
      if (contenuta) return { come: 'contiene', cartella: contenuta }
    }

    const programma = programmaDi(pezzo.parole)
    if (programma && amb.leggi) {
      const codice = (await amb.leggi(await lungo(programma)))?.toLowerCase()
      const nominata = codice && amb.cartelle.find(c => c.testi.some(t => nomina(codice, t)))
      if (nominata) return { come: 'programma', cartella: nominata }
    }

    if (primo === 'cd' || primo === 'pushd') dove = assoluto(resto[0] ?? '~', dove, amb.casa)
  }
  return undefined
}

/** La cartella protetta che un connettore nomina fra le sue istruzioni, a qualsiasi profondità. */
export function nominataDa(valore: unknown, amb: Pick<Ambiente, 'cwd' | 'casa' | 'cartelle'>): Cartella | undefined {
  const testi: string[] = []
  const raccogli = (v: unknown, profondita: number) => {
    if (typeof v === 'string') testi.push(v)
    else if (profondita < 8 && v !== null && typeof v === 'object') {
      for (const x of Object.values(v)) raccogli(x, profondita + 1)
    }
  }
  raccogli(valore, 0)
  for (const t of testi) {
    const minuscolo = t.toLowerCase()
    const nominata = amb.cartelle.find(c => c.testi.some(f => nomina(minuscolo, f)))
    if (nominata) return nominata
    if (/^(?:\/|~)/.test(t)) {
      const p = assoluto(t, amb.cwd, amb.casa)
      const sotto = amb.cartelle.find(c => c.percorsi.some(r => dentro(p, r)))
      if (sotto) return sotto
    }
  }
  return undefined
}

/** Se un comando prova a disinstallare, disattivare o riconfigurare la guardia (configure senza
 * --values-stdin mostra soltanto le impostazioni, e passa). */
export function spegneLaGuardia(comando: string): boolean {
  const t = comando.toLowerCase()
  const claude = /\bclaude\b[^\n;&|]*\bplugins?\b[^\n;&|]*/
  const spegne = new RegExp(`${claude.source}\\b(?:uninstall|remove|disable)\\b`)
  const riconfigura = new RegExp(`${claude.source}\\bconfigure\\b[^\\n;&|]*--values-stdin`)
  return t.includes(NOME) && (spegne.test(t) || riconfigura.test(t))
}

/** Se il file è un'impostazione di Claude Code o un file della guardia installata. */
export function fileDellaGuardia(percorso: string, casa: string): 'impostazioni' | 'installazione' | undefined {
  if (IMPOSTAZIONI.test(percorso)) return 'impostazioni'
  if (dentro(percorso, `${casa}/.claude/plugins`) && percorso.toLowerCase().includes(NOME)) return 'installazione'
  return undefined
}
