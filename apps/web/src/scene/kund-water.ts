/**
 * The kund's water (spec 02 § Kund): a still tank with slow, soft ripples and, now and then, a
 * small ring spreading from where a drop falls from the spring. Calm, never a splash.
 *
 * It is the greybox's Lambert water with a few lines of shader added: the ripples only lighten
 * and darken the water's colour a little, so it is lit like the rest of the scene by day and
 * night and costs a handful of sines per pixel (spec 10). With reduced motion the water is
 * still: the ripples stay where they are (spec 07 § Accessibility).
 */
import { MeshLambertMaterial, type ColorRepresentation } from "three";

/** How many drop rings can be spreading at once. */
const RINGS = 3;

export class KundWater {
  readonly material: MeshLambertMaterial;
  private readonly time = { value: 0 };

  constructor(color: ColorRepresentation, opacity: number) {
    this.material = new MeshLambertMaterial({ color, transparent: true, opacity });
    const time = this.time;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWater;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWater = position.xy;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${RIPPLE_GLSL}`)
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + kundRipple(vWater, uTime);",
        );
    };
    // One compiled program for every kund water, whatever the time.
    this.material.customProgramCacheKey = () => "kund-water";
  }

  update(dt: number, reducedMotion: boolean): void {
    if (!reducedMotion) this.time.value = (this.time.value + dt) % 3600;
  }
}

/** Ripple shading in the plane's own metres (its centre is 0, 0): about ±10 % of the colour. */
const RIPPLE_GLSL = /* glsl */ `
varying vec2 vWater;
uniform float uTime;

float kundHash(float n) { return fract(sin(n) * 43758.5453); }

float kundRipple(vec2 p, float t) {
  // Slow wind-ruffle: three long, faint waves crossing each other.
  float s = 0.035 * sin(dot(p, vec2(1.7, 0.6)) + t * 0.9)
          + 0.025 * sin(dot(p, vec2(-0.8, 2.1)) - t * 0.7)
          + 0.015 * sin(dot(p, vec2(3.1, -2.4)) + t * 1.3);
  // Drop rings: each one starts at a new spot every few seconds, spreads and fades.
  for (int i = 0; i < ${RINGS}; i++) {
    float fi = float(i);
    float period = 5.0 + fi * 1.7;
    float local = t + fi * 2.3;
    float cycle = floor(local / period);
    float age = local - cycle * period;
    float seed = cycle * 7.13 + fi * 31.7;
    vec2 at = (vec2(kundHash(seed), kundHash(seed + 1.9)) - 0.5) * 4.4;
    float d = length(p - at);
    float front = age * 0.45;
    float band = exp(-pow((d - front) * 3.2, 2.0));
    float fade = (1.0 - age / period) * smoothstep(0.0, 0.3, age);
    s += 0.09 * band * fade * sin((d - front) * 18.0);
  }
  return s;
}
`;
