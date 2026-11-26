import pineLarge from './pine_large.json';
import pineMedium from './pine_medium.json';
import pineSmall from './pine_small.json';
import bush1 from './bush_1.json';
import bush2 from './bush_2.json';
import bush3 from './bush_3.json';
import aspenMedium from './aspen_medium.json';
import oakMedium from './oak_medium.json';
import TreeOptions from '../options';

export const TreePreset = {
  'Pine Large': pineLarge,
  'Pine Medium': pineMedium,
  'Pine Small': pineSmall,
  'Bush 1': bush1,
  'Bush 2': bush2,
  'Bush 3': bush3,
  'Aspen Medium': aspenMedium,
  'Oak Medium': oakMedium,
};

export function loadPreset(name) {
  const preset = TreePreset[name];
  return preset ? structuredClone(preset) : new TreeOptions();
}
