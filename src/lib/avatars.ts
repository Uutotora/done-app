import { ANIMAL_AVATARS, defaultAnimalAvatar, isAnimalAvatar } from '../../shared/avatars.mjs';
import type { Person } from './types';

export { ANIMAL_AVATARS, defaultAnimalAvatar, isAnimalAvatar, randomAnimalAvatar } from '../../shared/avatars.mjs';

export const ANIMAL_AVATAR_ATLAS = '/illustrations/animal-avatars.png';

// Actual ink bounds in the generated 1536 × 1024 sheet. The drawing is not a
// perfectly aligned grid: crop each portrait independently, then fit it inside
// the avatar. Two source pixels preserve antialiasing around the contour.
const PORTRAIT_BOUNDS = [
  [60, 122, 225, 265],
  [301, 128, 490, 265],
  [557, 102, 730, 259],
  [810, 110, 981, 266],
  [1073, 81, 1217, 272],
  [1318, 117, 1475, 266],
  [43, 345, 240, 492],
  [311, 357, 478, 489],
  [558, 348, 728, 493],
  [795, 332, 993, 490],
  [1051, 344, 1241, 493],
  [1310, 332, 1478, 489],
  [61, 570, 223, 719],
  [315, 574, 471, 718],
  [550, 570, 735, 715],
  [809, 568, 985, 719],
  [1046, 542, 1244, 728],
  [1308, 553, 1482, 719],
  [54, 798, 230, 928],
  [272, 786, 514, 954],
  [541, 801, 742, 936],
  [813, 800, 978, 938],
  [1040, 769, 1248, 952],
  [1313, 792, 1477, 948],
];

export function personAnimalAvatar(person: Pick<Person, 'id' | 'avatar'>) {
  return isAnimalAvatar(person.avatar) ? person.avatar : defaultAnimalAvatar(person.id);
}

export function animalAvatarStyle(value: string, size: number) {
  const index = Math.max(
    0,
    ANIMAL_AVATARS.findIndex(({ id }) => value === `animal:${id}`),
  );
  const [left, top, right, bottom] = PORTRAIT_BOUNDS[index];
  const width = right - left + 4;
  const height = bottom - top + 4;
  const scale = (size * 0.8) / Math.max(width, height);
  return {
    width: width * scale,
    height: height * scale,
    backgroundColor: '#fff',
    backgroundImage: `url("${ANIMAL_AVATAR_ATLAS}")`,
    backgroundSize: `${1536 * scale}px ${1024 * scale}px`,
    backgroundPosition: `${-(left - 2) * scale}px ${-(top - 2) * scale}px`,
    backgroundRepeat: 'no-repeat',
  };
}
