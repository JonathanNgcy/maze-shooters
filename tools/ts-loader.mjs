// Development command-line runner for the pure TypeScript modules; no game runtime dependency.
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context);}catch(error){if(!specifier.startsWith('.'))throw error;for(const suffix of ['.ts','/index.ts']){try{return nextResolve(specifier+suffix,context);}catch{}}throw error;}}});
