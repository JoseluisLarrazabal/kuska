/**
 * Re-export delgado: `burner.ts` ya expone `isPersistent()` con la misma
 * semántica que necesitaba esta heurística propia (que existía solo porque,
 * en el momento en que se escribió este módulo, `burner.ts` todavía no la
 * tenía). Se mantiene el nombre `isBurnerPersistent` para no tocar los
 * imports existentes en las páginas.
 */
export { isPersistent as isBurnerPersistent } from "../burner";
