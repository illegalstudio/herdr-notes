# Herdr Notes logo

The approved paper bird is the Herdr Notes logo. Its curved ivory paper
and sage folds are preserved in the dark version; the light version uses
forest green and sage for contrast.

All images are square PNGs at their native resolution, 1254 x 1254 pixels.

| Variant | File | Use |
| --- | --- | --- |
| Dark background | [logo-dark.png](logo-dark.png) | Original approved artwork, unchanged |
| Light background | [logo-light.png](logo-light.png) | Green bird on warm ivory |
| Transparent for dark backgrounds | [logo-transparent-dark.png](logo-transparent-dark.png) | Ivory and sage bird, with alpha |
| Transparent for light backgrounds | [logo-transparent-light.png](logo-transparent-light.png) | Forest green and sage bird, with alpha |

Use the transparent variant that matches the intended surface. Preserve the
square canvas and its clear space. The transparent PNGs were inspected on
their intended backgrounds, retaining their generated alpha channels.

## Production

The original approved image was copied unchanged to `logo-dark.png`.
Variants were edited with the built-in `image_gen` tool. The prompts below
record the final edits; the artwork was not redrawn.

### Light background

Input: `logo-dark.png`.

Use case: precise-object-edit. Asset type: Herdr Notes logo, light-background variant. Image 1 is the exact approved edit target. Change ONLY the color treatment for a light surface. Replace the deep green background with warm ivory #F5F2E9. Recolor the ivory paper surfaces of the bird to deep forest green, around #164437, and the muted jade fold surfaces to a lighter sage green around #78917B so the folds remain legible. Preserve the exact approved bird silhouette, wing curves, head, beak, forked tail, graceful paper folds, subtle material shading, scale, placement and square canvas. Keep the composition identical. No redesign, no simplification, no added outlines, text, objects or shadows.

### Transparent for light backgrounds

Input: `logo-light.png`. Transparent output enabled.

Use case: background-extraction. Asset type: Herdr Notes logo, transparent variant for light backgrounds. Image 1 is the approved green paper-bird variant and the edit target. Remove ONLY the ivory background and replace all empty areas with genuine transparent alpha, including the spaces between the wing and tail. Preserve the green and sage paper bird exactly: same silhouette, delicate paper folds, curved wings, beak, forked tail, internal shading, placement, size and square canvas. Keep its interior fully opaque. A clean production-quality cutout with smooth antialiased contours and no stray pixels, dust, fringe, pale patches or halos outside the bird. Do not redesign, simplify, recolor or reframe anything.

### Transparent for dark backgrounds

Inputs: `logo-transparent-light.png` as edit target and `logo-dark.png`
as color reference. Transparent output enabled.

Use case: precise-object-edit. Asset type: Herdr Notes transparent logo for dark surfaces. Image 1 is the EDIT TARGET: a clean transparent green paper-bird cutout. Image 2 is the COLOR AND MATERIAL REFERENCE ONLY: the approved ivory and sage paper bird on a green background. Recolor ONLY the bird in image 1 to match the ivory paper and muted sage folds of image 2. Keep the exact existing silhouette, graceful curves, delicate paper shading, scale, position, square canvas, and transparent alpha footprint from image 1. The transparent background of image 1 MUST REMAIN TRANSPARENT and perfectly empty. Do not add or extend any pixels beyond its clean contour. Preserve its mask, do not re-extract the background from image 2. No background, halos, dust, scattered pixels, texture outside the bird, borders, new objects or text. The final result is the same clean transparent bird as image 1 with only its colors changed to the ivory-and-sage palette of image 2.
