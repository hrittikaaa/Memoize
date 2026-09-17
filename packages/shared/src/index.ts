export type Difficulty = 'easy' | 'medium' | 'hard';
export type ProblemStatus = 'not_started' | 'attempted' | 'solved';
export type ProblemSource = 'imported' | 'manual';

export interface TopicDTO {
  id: string;
  name: string;
  slug: string;
}

export interface ProblemDTO {
  id: string;
  leetcodeSlug: string | null;
  title: string;
  url: string;
  difficulty: Difficulty;
  topics: TopicDTO[];
}

export interface UserProblemDTO {
  id: string;
  status: ProblemStatus;
  needsRevision: boolean;
  notes: string | null;
  source: ProblemSource;
  firstSolvedAt: string | null;
  lastTouchedAt: string;
  problem: ProblemDTO;
}
