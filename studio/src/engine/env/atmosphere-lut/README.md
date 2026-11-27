# Coastal atmosphere tables

`coastal.bin` packs the half-float transmittance table and the first eight altitude slices of
the combined scattering table from `@takram/three-atmosphere@0.19.1`. This keeps the angular
resolution and low-altitude values of the published Bruneton precomputation. The scene only
looks up scattering close to the surface. The runtime scales the texture's Z coordinate
to address the cropped table. No irradiance table is needed because scene lighting comes
from the existing HDRI, directional light and baked lightmaps.

The file is gzip-compressed. From the workspace root, regenerate it with the installed package.

```sh
(
  cat node_modules/@takram/three-atmosphere/assets/transmittance.bin
  head -c 2097152 node_modules/@takram/three-atmosphere/assets/scattering.bin
) | gzip -n -9 > src/engine/env/atmosphere-lut/coastal.bin
```

See [the notices](ATMOSPHERE-LICENSE.txt) for three-geospatial and Precomputed Atmospheric Scattering.
