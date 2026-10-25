import type { EngineInterface, Register } from 'claude-code'

import type { Cartella } from './regole'
import {
  LETTURA,
  NOME,
  assoluto,
  dentro,
  elenco,
  esamina,
  fileDellaGuardia,
  nominataDa,
  normalizza,
  spegneLaGuardia,
  testiDi,
} from './regole'

// Un programma più grande di così non si legge: la guardia lo lascia partire.
const MAX_PROGRAMMA = 1_000_000

const REGOLA = `Claude può leggere le cartelle protette ma non scriverci: né con gli strumenti dei file, né dal terminale, git compreso, perché scrive anche quando sembra solo leggere. Dal terminale passano i comandi che leggono (${LETTURA.join(', ')}), senza redirezioni verso file. Se il percorso compare solo come testo, per esempio nel messaggio di un commit, riscrivilo senza. Non cercare un'altra strada per fare la stessa cosa: se serve davvero, chiedi alla persona di togliere la cartella dall'elenco.`
const AUTODIFESA = `${NOME}: fermato. Le impostazioni della guardia e la sua installazione le cambia solo la persona, dal menu delle mod (/plugin). Non cercare un'altra strada: chiedi alla persona.`
const GUASTA = `${NOME}: la guardia si è rotta mentre controllava e nel dubbio ferma questa azione, perché nomina una cartella protetta. Dillo alla persona.`

// Per ogni modo di toccare una cartella: la frase per Claude e la riga per la persona.
const MODI = {
  scrive: {
    frase: (c: string) => `Il comando scriverebbe in «${c}», che è una cartella protetta.`,
    riga: (c: string) => `ho fermato un comando che avrebbe scritto in ${c}.`,
  },
  contiene: {
    frase: (c: string) => `Il comando cancellerebbe, sposterebbe o cambierebbe una cartella che contiene «${c}», che è protetta.`,
    riga: (c: string) => `ho fermato un comando che avrebbe toccato la cartella che contiene ${c}.`,
  },
  programma: {
    frase: (c: string) => `Il programma che stai per lanciare nomina «${c}», che è una cartella protetta, e la guardia non può sapere se ci scrive.`,
    riga: (c: string) => `ho fermato un programma che nomina ${c}.`,
  },
  file: {
    frase: (c: string) => `Il file sta in «${c}», che è una cartella protetta.`,
    riga: (c: string) => `ho fermato una modifica a un file di ${c}.`,
  },
  connettore: {
    frase: (c: string) => `Lo strumento nomina «${c}», che è una cartella protetta, e la guardia non può sapere se ci scrive. Per leggerla usa gli strumenti di Claude Code.`,
    riga: (c: string) => `ho fermato un connettore che nomina ${c}.`,
  },
}

// Le scelte della persona all'installazione.
type Scelte = { scritte: string[]; lavorareDentro: boolean }

const ferma = ($: EngineInterface, modo: keyof typeof MODI, cartella: Cartella) => {
  $.ui.log(MODI[modo].riga(cartella.scritta))
  return { deny: `${NOME}: fermato. ${MODI[modo].frase(cartella.scritta)} ${REGOLA}` }
}

const difendi = ($: EngineInterface) => {
  $.ui.log('ho fermato un tentativo di cambiare le impostazioni della guardia.')
  return { deny: AUTODIFESA }
}

// Dove porta davvero un percorso, collegamenti seguiti: il file se c'è, se no la sua
// cartella più il nome; se nemmeno quella c'è, il percorso com'è scritto.
async function reale($: EngineInterface, percorso: string): Promise<string> {
  const proprio = await $.fs.stat(percorso, { resolve: true }).catch(() => undefined)
  if (proprio?.realPath) return normalizza(proprio.realPath)
  const taglio = percorso.lastIndexOf('/')
  if (taglio <= 0) return percorso
  const cartella = await $.fs.stat(percorso.slice(0, taglio), { resolve: true }).catch(() => undefined)
  return cartella?.realPath ? normalizza(`${cartella.realPath}/${percorso.slice(taglio + 1)}`) : percorso
}

async function leggiProgramma($: EngineInterface, percorso: string): Promise<string | undefined> {
  const info = await $.fs.stat(percorso).catch(() => undefined)
  if (!info || info.kind !== 'file' || info.size > MAX_PROGRAMMA) return undefined
  return $.fs.read(percorso).catch(() => undefined)
}

// Le cartelle dell'elenco, con dove portano davvero, e quali valgono in questa sessione:
// quelle in cui la sessione è stata aperta restano libere, se la persona l'ha scelto.
async function stato($: EngineInterface, scelte: Scelte) {
  const casa = normalizza((await $.env.get('HOME')) ?? '/')
  const tutte: Cartella[] = await Promise.all(
    scelte.scritte.map(async scritta => {
      const assoluta = assoluto(scritta, casa, casa)
      const percorsi = [...new Set([assoluta, await reale($, assoluta)])]
      return { scritta, percorsi, testi: testiDi(percorsi, casa) }
    }),
  )
  const radice = await reale($, normalizza(await $.session.root()))
  const libere = scelte.lavorareDentro ? tutte.filter(c => c.percorsi.some(p => dentro(radice, p))) : []
  const cwd = normalizza(await $.session.cwd())
  return { casa, cwd, attive: tutte.filter(c => !libere.includes(c)), libere }
}

async function giudicaComando($: EngineInterface, scelte: Scelte, comando: string) {
  if (spegneLaGuardia(comando)) return difendi($)
  const { casa, cwd, attive } = await stato($, scelte)
  const tocco = await esamina(comando, {
    cwd,
    casa,
    cartelle: attive,
    reale: p => reale($, p),
    leggi: p => leggiProgramma($, p),
  })
  if (tocco === undefined) return undefined
  return tocco.come === 'impostazioni' ? difendi($) : ferma($, tocco.come, tocco.cartella)
}

// `testo` è quello che la modifica toglie e mette; per una riscrittura intera conta il file com'è ora.
async function giudicaFile($: EngineInterface, scelte: Scelte, percorso: string, testo?: string) {
  const { casa, cwd, attive } = await stato($, scelte)
  const p = await reale($, assoluto(percorso, cwd, casa))
  const proprio = fileDellaGuardia(p, casa)
  if (proprio === 'installazione') return difendi($)
  if (proprio === 'impostazioni') {
    const toccato = testo ?? (await $.fs.read(p).catch(() => ''))
    if (toccato.includes(NOME)) return difendi($)
  }
  const cartella = attive.find(c => c.percorsi.some(r => dentro(p, r)))
  return cartella ? ferma($, 'file', cartella) : undefined
}

// I connettori: la guardia non sa cosa fanno, quindi ferma quelli che nominano una cartella protetta.
async function giudicaConnettore($: EngineInterface, scelte: Scelte, chiamata: unknown) {
  const { casa, cwd, attive } = await stato($, scelte)
  const cartella = nominataDa(chiamata, { cwd, casa, cartelle: attive })
  return cartella ? ferma($, 'connettore', cartella) : undefined
}

async function apertura($: EngineInterface, scelte: Scelte) {
  const { attive, libere } = await stato($, scelte).catch(() => ({ attive: [], libere: [] }))
  $.ui.log(rigaDiApertura(attive, libere))
}

function rigaDiApertura(attive: readonly Cartella[], libere: readonly Cartella[]): string {
  const nomi = (cs: readonly Cartella[]) => cs.map(c => c.scritta).join(', ')
  if (attive.length === 0 && libere.length === 0) {
    return `nessuna cartella da proteggere: aggiungile dal menu delle mod (/plugin), alla voce ${NOME}.`
  }
  const quante = attive.length === 1 ? '1 cartella' : `${attive.length} cartelle`
  const riga = attive.length > 0 ? `attiva su ${quante}: ${nomi(attive)}.` : 'nessuna cartella attiva in questa sessione.'
  return libere.length === 0
    ? riga
    : `${riga} Qui la guardia si fa da parte per ${nomi(libere)}, perché hai aperto la sessione lì dentro.`
}

// Nel dubbio, quando la guardia si rompe, ferma solo quello che nomina una cartella dell'elenco.
function sospetto(scelte: Scelte, testo: string | undefined): boolean {
  const t = (testo ?? '').toLowerCase()
  return scelte.scritte.some(s => {
    const minuscolo = s.toLowerCase()
    return t.includes(minuscolo) || (minuscolo.startsWith('~/') && t.includes(minuscolo.slice(1)))
  })
}

export const register: Register = (on, options) => {
  const scelte: Scelte = { scritte: elenco(options.cartelle), lavorareDentro: options.lavorare_dentro !== false }

  on('session.start', async ($, e, next) => {
    const fatto = await next(e)
    await apertura($, scelte)
    return fatto
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => (await giudicaComando($, scelte, e.command)) ?? next(e)).catch(
    ($, e, next) => (next.called || !sospetto(scelte, e.command) ? next(e) : { deny: GUASTA }),
  )

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) =>
    e.command === undefined ? next(e) : ((await giudicaComando($, scelte, e.command)) ?? next(e)),
  ).catch(($, e, next) => (next.called || !sospetto(scelte, e.command) ? next(e) : { deny: GUASTA }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) =>
    (await giudicaFile($, scelte, e.file_path, `${e.old_string}\n${e.new_string}`)) ?? next(e),
  ).catch(($, e, next) => (next.called || !sospetto(scelte, e.file_path) ? next(e) : { deny: GUASTA }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => (await giudicaFile($, scelte, e.file_path)) ?? next(e)).catch(
    ($, e, next) => (next.called || !sospetto(scelte, e.file_path) ? next(e) : { deny: GUASTA }),
  )

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) =>
    (await giudicaFile($, scelte, e.notebook_path, '')) ?? next(e),
  ).catch(($, e, next) => (next.called || !sospetto(scelte, e.notebook_path) ? next(e) : { deny: GUASTA }))

  on('tool.call', async ($, e, next) =>
    String(e.tool).startsWith('mcp__') ? ((await giudicaConnettore($, scelte, e)) ?? next(e)) : next(e),
  ).catch(($, e, next) =>
    next.called || !String(e.tool).startsWith('mcp__') || !sospetto(scelte, JSON.stringify(e)) ? next(e) : { deny: GUASTA },
  )
}
