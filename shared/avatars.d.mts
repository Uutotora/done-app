export type AnimalAvatar = `animal:${string}`;
export const ANIMAL_AVATARS: readonly { id: string; ru: string; en: string }[];
export function isAnimalAvatar(value: unknown): value is AnimalAvatar;
export function isValidAvatar(value: unknown): boolean;
export function defaultAnimalAvatar(id: string): AnimalAvatar;
export function randomAnimalAvatar(exclude?: string): AnimalAvatar;
