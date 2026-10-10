// The library of spines (story arcs) that ships with FountainPen. It mirrors the `spines` directory
// of the Fountain Cascade repository: stage IDs and names are fixed there, descriptions are in goal terms.
export interface Stage { id: string; name: string; about?: string }
export interface Spine { id: string; name: string; stages: Stage[] }

export const LIBRARY: Record<string, Spine> = {
  'heros-journey': {
    id: 'heros-journey', name: "The Hero's Journey",
    stages: [
      { id: 'ordinary-world', name: 'Ordinary World', about: "The hero's life before the story's top-level goal exists." },
      { id: 'call-to-adventure', name: 'Call to Adventure', about: 'The top-level goal is created, often handed over or forced on the hero.' },
      { id: 'refusal-of-the-call', name: 'Refusal of the Call', about: 'The goal exists but is not taken up.' },
      { id: 'meeting-the-mentor', name: 'Meeting the Mentor', about: 'A preparation. The hero is equipped, taught, or pushed, and accepts the goal.' },
      { id: 'crossing-the-threshold', name: 'Crossing the Threshold', about: 'The hero commits, and turning back now has a cost.' },
      { id: 'tests-allies-enemies', name: 'Tests, Allies, Enemies', about: 'Sequences with smaller goals serving the top-level one. New agents enter.' },
      { id: 'approach', name: 'Approach to the Inmost Cave', about: 'A second preparation. A goal is often raised here.' },
      { id: 'ordeal', name: 'The Ordeal', about: "The hero's goals collide, or the top-level goal is nearly lost." },
      { id: 'reward', name: 'Reward', about: 'A goal is won, often at a price.' },
      { id: 'road-back', name: 'The Road Back', about: 'What was won is put at risk again.' },
      { id: 'resurrection', name: 'Resurrection', about: 'The final contest for the top-level goal.' },
      { id: 'return-with-the-elixir', name: 'Return with the Elixir', about: 'The top-level goal has its final status, and the hero returns changed.' },
    ],
  },
};
