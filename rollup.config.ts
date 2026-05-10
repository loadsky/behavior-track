import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import { visualizer } from 'rollup-plugin-visualizer';
import obfuscator from 'rollup-plugin-obfuscator';

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
    production && obfuscator({
      global: false,
      options: {
        target: 'browser-no-eval',
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        debugProtectionInterval: 0,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'mangled-shuffled',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false,
        selfDefending: false,
        simplify: true,
        splitStrings: false,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayCallsTransformThreshold: 0.5,
        stringArrayEncoding: ['base64'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: false,
        stringArrayWrappersParametersMaxCount: 2,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.75,
        unicodeEscapeSequence: false,
        transformObjectKeys: true,
        ignoreImports: true,
      },
    }),
    production && visualizer({ filename: 'dist/stats.html', gzipSize: true }),
  ],
});
