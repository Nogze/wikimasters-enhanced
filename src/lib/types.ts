const RARITIES = ['L', 'UR', 'SR', 'R', 'PC', 'C'] as const;
export type Rarity = (typeof RARITIES)[number];

// Card data comes from a Wikipedia article and doesn't change once generated,
// which is why it can be cached indefinitely on the client.
export type Card = {
  id: string;
  atk: number;
  def: number;
  lang: string;
  rarity: Rarity;
  q_score: number;
  category: string | null;
  image_url: string | null;
  pageviews: number;
  sensitive: boolean;
  wikipedia_url: string;
  title: string;
  /** First ~220 characters of the article (the text face of cards without an image). */
  excerpt?: string | null;
};

export type Tag = { id: string; name: string; color: string | null };

export type Notification = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  created_at: string;
};
