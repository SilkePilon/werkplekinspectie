// The single list of inspection questions, shared by client, validation, PDF and mail.
// Texts are copied verbatim from spec §5 ("De 21 vragen" and "Onderdelen").

/** Title of the original paper form; used in the PDF and the mail. */
export const FORM_TITLE = 'Werkplekinspectie Arbo en Milieu';

export const QUESTION_IDS = [
  '1A', '1B', '1C', '1D', '2A', '2B', '2C', '3A', '3B', '4A', '4B', '4C',
  '5A', '6A', '7A', '7B', '8A', '8B', '8C', '9A', '9B',
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export type SectionIconName =
  | 'instructie'
  | 'werkomgeving'
  | 'gereedschap'
  | 'brand'
  | 'pbm'
  | 'werk'
  | 'hygiene'
  | 'milieu'
  | 'ehbo';

export interface Section {
  nr: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Short name shown in the app. */
  title: string;
  /** Name as printed on the original form (PDF). */
  formTitle: string;
  icon: SectionIconName;
}

export interface Question {
  id: QuestionId;
  section: Section['nr'];
  /** Short, positive question shown in the app (A2/B1). */
  appText: string;
  /** Original form wording, shown in the PDF. */
  formText: string;
}

export const SECTIONS: readonly Section[] = [
  { nr: 1, title: 'Instructie', formTitle: 'Instructie', icon: 'instructie' },
  { nr: 2, title: 'Werkomgeving', formTitle: 'Werkomgeving', icon: 'werkomgeving' },
  { nr: 3, title: 'Gereedschap', formTitle: 'Gereedschappen en klimmaterieel', icon: 'gereedschap' },
  { nr: 4, title: 'Brandpreventie', formTitle: 'Brandpreventie', icon: 'brand' },
  { nr: 5, title: 'Beschermingsmiddelen', formTitle: 'Persoonlijke beschermingsmiddelen', icon: 'pbm' },
  { nr: 6, title: 'Werkzaamheden', formTitle: 'Werkzaamheden', icon: 'werk' },
  { nr: 7, title: 'Hygiëne', formTitle: 'Persoonlijke hygiëne', icon: 'hygiene' },
  { nr: 8, title: 'Milieu', formTitle: 'Milieu', icon: 'milieu' },
  { nr: 9, title: 'EHBO', formTitle: 'EHBO', icon: 'ehbo' },
];

export const QUESTIONS: readonly Question[] = [
  { id: '1A', section: 1, formText: 'VGM-handboekje voorhanden', appText: 'Heb je het VGM-handboekje bij je?' },
  { id: '1B', section: 1, formText: 'bekendheid met calamiteitenplan ter plaatse', appText: 'Weet je wat je moet doen bij een noodgeval op deze plek?' },
  { id: '1C', section: 1, formText: 'veiligheidsinstructie opdrachtgever gekregen', appText: 'Heb je een veiligheidsinstructie van de opdrachtgever gekregen?' },
  { id: '1D', section: 1, formText: 'LMRA pas voorhanden', appText: 'Heb je je LMRA-kaart bij je?' },
  { id: '2A', section: 2, formText: 'goed bereikbaar/opgeruimd/verlicht', appText: 'Is je werkplek goed bereikbaar, opgeruimd en verlicht?' },
  { id: '2B', section: 2, formText: 'fysieke belasting/klimaat/geluid/bewegingsvrijheid', appText: 'Kun je hier goed werken? Denk aan tillen, temperatuur, geluid en ruimte.' },
  { id: '2C', section: 2, formText: 'veiligheid en afzetting', appText: 'Is de werkplek veilig en goed afgezet?' },
  { id: '3A', section: 3, formText: 'staat van onderhoud', appText: 'Zijn je gereedschap en klimmaterieel in goede staat?' },
  { id: '3B', section: 3, formText: 'gekeurd', appText: 'Zijn je gereedschap en klimmaterieel gekeurd?' },
  { id: '4A', section: 4, formText: 'blusmiddelen aanwezig en bereikbaar', appText: 'Zijn er blusmiddelen, en kun je erbij?' },
  { id: '4B', section: 4, formText: 'blusmiddelen gekeurd', appText: 'Zijn de blusmiddelen gekeurd?' },
  { id: '4C', section: 4, formText: 'vluchtwegen aanwezig, aangegeven en vrij van obstakels', appText: 'Zijn de vluchtwegen er, zijn ze aangegeven en zijn ze vrij?' },
  { id: '5A', section: 5, formText: 'PBM gebruik', appText: 'Gebruik je de juiste beschermingsmiddelen (PBM)?' },
  { id: '6A', section: 6, formText: 'worden ze veilig uitgevoerd', appText: 'Wordt het werk veilig uitgevoerd?' },
  { id: '7A', section: 7, formText: 'wasgelegenheid aanwezig', appText: 'Kun je je hier wassen?' },
  { id: '7B', section: 7, formText: 'kantine of pauzeruimte aanwezig', appText: 'Is er een kantine of pauzeruimte?' },
  { id: '8A', section: 8, formText: 'afvalstoffen gescheiden', appText: 'Wordt het afval gescheiden?' },
  { id: '8B', section: 8, formText: 'opslagmogelijkheid afvalstoffen aanwezig', appText: 'Is er een plek om afval op te slaan?' },
  { id: '8C', section: 8, formText: 'afvoermogelijkheid afvalstoffen aanwezig', appText: 'Kan het afval worden afgevoerd?' },
  { id: '9A', section: 9, formText: 'EHBO-doos aanwezig en compleet', appText: 'Is er een EHBO-doos, en is hij compleet?' },
  { id: '9B', section: 9, formText: 'persoon met EHBO-diploma aanwezig', appText: 'Is er iemand met een EHBO-diploma?' },
];
