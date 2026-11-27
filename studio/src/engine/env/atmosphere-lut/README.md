# Coastal atmosphere tables

The studio generates these textures on the GPU with the Bruneton shaders from
`@takram/three-atmosphere`. It starts after the studio reports ready and a daylight
exterior is visible. The HDRI stays visible while the GPU works. The completed sky,
distance haze and ocean haze fade in together. The HDRI also supplies scene lighting
and reflections.

The scattering LUT retains the published angular grid and the first four altitude
slices. The multiple-scattering passes use a temporary volume with additional,
more widely spaced samples up to the top of the atmosphere. Only the transmittance
and low-altitude scattering textures remain after generation.

See [the notices](ATMOSPHERE-LICENSE.txt) for three-geospatial and Precomputed
Atmospheric Scattering.
