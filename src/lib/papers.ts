export interface Paper {
  code: string;
  qualification: "IAL" | "IGCSE";
  subject: string;
  unit: string;
  name: string;
  session: string;
  qp?: string | null;
  ms?: string | null;
  source?: string;
}

export interface PaperIndex {
  papers: Paper[];
  subjects: string[];
  qualifications: string[];
  updated: string;
}
