import { z } from 'zod';
import { arabicCheck } from '../lib.js';

export default {
  name: 'arabic_msa_check',
  description: 'Check Arabic copy against house style (MSA, no diacritics, no tatweel, Arabic punctuation, consistent digits). Returns issues and a cleaned version.',
  input: { text: z.string().min(1).max(20000) },
  readOnly: true,
  async run({ text }) {
    return arabicCheck(text);
  },
};
