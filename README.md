# cartelle-protette

Una mod per Claude Code che tiene al sicuro le cartelle che scegli tu: Claude può leggerle, cercarci dentro e riassumerne i file, ma non può modificarle.

## Cosa fa

Scegli le cartelle, per esempio `~/Documenti/Contratti`. Da quel momento, se Claude prova a modificare un file lì dentro, a lanciare un comando o un programma che ci scrive, viene fermato. Succede lo stesso se prova a cancellare o spostare la cartella che le contiene, o a spegnere la guardia. Ogni volta compare una riga che dice cosa è stato fermato, e Claude riceve il motivo, così non cerca un'altra strada.

Leggere invece si può sempre. Dal terminale passano i comandi che leggono soltanto: `ls`, `cat`, `head`, `tail`, `grep`, `find`, `stat`, `du`, `wc` ed `echo`. Il resto si ferma, `git` compreso, perché anche `git status` scrive dentro la cartella.

Se apri Claude Code dentro una cartella protetta, perché ci vuoi lavorare apposta, lì la guardia si fa da parte. Se preferisci che resti accesa anche in quel caso, all'installazione rispondi no.

## Cosa serve

Claude Code 2.1.292 o successivo, nel terminale, in VS Code o nella scheda Code dell'app desktop. Per sapere che versione hai scrivi `claude --version` nel terminale, per aggiornarla `claude update`. Con una versione più vecchia la mod non parte, e non te lo dice.

È provata su Mac. Su Linux dovrebbe comportarsi allo stesso modo, su Windows non è stata provata.

## Come si installa

**Da VS Code.** Nella chat di Claude scrivi `/plugins` e si apre la gestione delle mod. Nella scheda Marketplaces aggiungi `Iggy56/cartelle-protette`, poi nella scheda Plugins installa `cartelle-protette` con «Install for you». Subito dopo compare il modulo con le due domande.

**Dal terminale.** Dentro una sessione di Claude Code, non nel terminale normale, scrivi:

```
/plugin install cartelle-protette --marketplace Iggy56/cartelle-protette
```

Rispondi `y` per aggiungere il catalogo, scegli l'ambito «user» perché valga in tutti i progetti, e rispondi alle due domande. Se il comando non riconosce `--marketplace`, fallo in due passi:

```
/plugin marketplace add Iggy56/cartelle-protette
/plugin install cartelle-protette@cartelle-protette
```

Le domande sono queste:

- **Cartelle protette**, una per riga, per esempio `~/Documenti/Contratti`.
- **Lavorare dentro la cartella**: sì (la risposta di partenza) se vuoi che la guardia si faccia da parte quando apri Claude Code dentro una cartella protetta, no se deve restare accesa anche lì.

Se installi con `claude plugin install` dal terminale normale le domande non compaiono. Le compili dopo, dentro una sessione, con `/plugin configure cartelle-protette@cartelle-protette`.

## Come capire se è accesa

All'apertura di ogni sessione compare una riga come «attiva su 2 cartelle: ~/Documenti/Contratti, ~/Clienti.». Se la riga manca la guardia è spenta, quasi sempre per una versione di Claude Code troppo vecchia.

## Cambiare le cartelle

Apri la gestione delle mod (`/plugins` in VS Code, `/plugin` nel terminale), scegli `cartelle-protette` e poi «Configure options». Claude non può farlo al posto tuo: la guardia ferma anche i suoi tentativi di cambiarle le impostazioni, disattivarla o disinstallarla.

## Quando ferma una cosa innocua

Ogni tanto succede. Un messaggio di commit che contiene il percorso di una cartella protetta viene fermato, e Claude lo riscrive senza. Un comando che pulisce in un colpo solo la cartella che contiene quella protetta viene fermato, e Claude deve restringerlo. In tutti e due i casi la riga dice cosa è successo.

## Cosa non copre

La mod vive dentro Claude Code e ferma quello che fa Claude Code, compresi i suoi sotto-agenti e i connettori. Non può fermare:

- le altre app: se apri un file in Word e lo salvi, o se Dropbox sincronizza, la mod non c'entra;
- Claude usato da altre app, come la chat di Claude Desktop con l'accesso ai file o Cowork;
- un programma che scrive nella cartella per conto suo, senza che il comando la nomini;
- le versioni di Claude Code precedenti alla 2.1.292.

Riduce il rischio, non lo azzera. Una cartella che nessuno deve mai cambiare, come un archivio, puoi bloccarla anche dal Mac: nel Finder, tasto destro sulla cartella, «Ottieni informazioni», e in «Condivisione e permessi» metti «Sola lettura», poi «Applica agli elementi inclusi» dal menu con l'ingranaggio. Così si ferma qualsiasi app, tu compreso, e la mod impedisce a Claude di togliere il blocco.

## Per chi vuole guardare dentro

Le regole stanno in `hooks/regole.ts`, il collegamento con Claude Code in `hooks/register.ts`. La mod non scrive, non cancella e non sposta niente, non va in rete e non chiama l'IA: legge i percorsi e i programmi che Claude sta per lanciare e dice sì o no. Le prove si lanciano dalla cartella della mod con `claude plugin test .`.

## Licenza

MIT: puoi usarla, modificarla e condividerla. È data così com'è, senza garanzie.

Damiano Ravanelli
