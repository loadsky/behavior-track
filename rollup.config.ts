import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

const production = !process.env.ROLLUP_WATCH;

export default defineConfig({
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/behavior-track.esm.js',
      format: 'es',
      sourcemap: true,
    },
    {
      file: 'dist/behavior-track.cjs.js',
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: 'dist/behavior-track.umd.js',
      format: 'umd',
      name: 'BehaviorTrack',
      sourcemap: true,
    },
  ],
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', declaration: true, declarationDir: 'dist/types' }),
    production && terser(),
  ],
});
