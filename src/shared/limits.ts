// Size limits shared by the phone and the server. Kept apart from schema.ts so the app can
// read them without bundling zod (about a third of its JavaScript).

/** Every text field: at most 250 characters, on the phone and on the server. */
const TEXT_MAX = 250;

export const LIMITS = {
  monteur: TEXT_MAX,
  project: TEXT_MAX,
  projectnummer: TEXT_MAX,
  comment: TEXT_MAX,
  goodPractice: TEXT_MAX,
  photosPerItem: 3,
  photosTotal: 15,
  photoBytes: 1_500_000,
  signatureBytes: 300_000,
  bodyBytes: 12_000_000,
} as const;
