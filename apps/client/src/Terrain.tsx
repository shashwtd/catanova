import { useEffect, useRef, useState } from 'react';
import { decodedGameImage, TERRAIN_ART, ENVIRONMENT_ART, GOLD_ART } from './game-assets.js';
import { isLand } from '../../../packages/rules/src/board.js';
import type { Board } from '../../../packages/rules/src/board.js';
import {
  GOLD_TILE,
  HEX_SIZE,
  ISLAND_SHADOW,
  MATERIAL_GUTTER,
  SEA_BAND,
  SEA_EDGE_WAVES,
  OPEN_WATER_PATCH,
  SEA_SMOOTHING,
  SHOAL_SMOOTHING,
  WATER_BAND,
  WATER_FEATHER,
  WATER_EDGE_WAVES,
  TERRAIN_INDEX,
  boardKey,
  hasSea,
  worldBox,
} from './scene.js';

/**
 * The most hexes the terrain shader takes: well past any board planned, the largest Open Sea frame included, and
 * with room to spare in the 224 uniform vectors every WebGL 2 fragment shader is guaranteed.
 */
export const MAX_TERRAIN_HEXES = 128;
/** The most sea hexes the sea shader takes besides them, two to a uniform vector. */
export const MAX_SEA_HEXES = 128;
/**
 * What the terrain shader is given for a board: each land hex's centre and tile, how many there are, the box. On
 * a board with sea, the sea hexes' centres too, two to a vector: they make the frame the water fills, and nothing
 * else, since only land makes a coast.
 */
export function terrainUniforms(board: Board) {
  const land = board.hexes.filter(isLand),
    sea = board.hexes.filter((h) => !isLand(h));
  if (land.length > MAX_TERRAIN_HEXES)
    throw new Error(`The terrain shader takes ${MAX_TERRAIN_HEXES} hexes, not ${land.length}`);
  if (sea.length > MAX_SEA_HEXES)
    throw new Error(`The terrain shader takes ${MAX_SEA_HEXES} sea hexes, not ${sea.length}`);
  // Only the sea shader samples the gold field's texture.
  if (!sea.length && land.some((h) => TERRAIN_INDEX[h.terrain] === GOLD_TILE))
    throw new Error('The terrain shader draws gold fields on boards with sea');
  return {
    land: new Float32Array(land.flatMap((h) => [h.x * HEX_SIZE, h.y * HEX_SIZE, TERRAIN_INDEX[h.terrain]])),
    count: land.length,
    sea: new Float32Array(
      Array.from({ length: Math.ceil(sea.length / 2) * 4 }, (_, i) => {
        const h = sea[Math.floor(i / 2)];
        return h ? (i % 2 ? h.y : h.x) * HEX_SIZE : 0;
      }),
    ),
    seaCount: sea.length,
    world: worldBox(board),
  };
}

const vertexSource = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main(){ vUv=(aPosition+1.0)*0.5; gl_Position=vec4(aPosition,0.0,1.0); }
`;
/** Noise, the signed hex distance and the mirrored environment material, as both terrain shaders use them. */
const shaderFunctions = `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float hex(vec2 p,float r){p=abs(p.yx);r*=0.8660254;vec3 k=vec3(-0.8660254,0.5,0.57735027);p-=2.0*min(dot(k.xy,p),0.0)*k.xy;p-=vec2(clamp(p.x,-k.z*r,k.z*r),r);return length(p)*sign(p.y);}
// Mirrored repeats share the same edge samples; a gutter prevents neighboring atlas bleed.
vec3 environment(vec2 uv,vec2 cell){
  vec2 mirrored=1.0-abs(mod(uv,2.0)-1.0);
  float gutter=${(MATERIAL_GUTTER / 512).toFixed(8)};
  vec2 inset=mix(vec2(gutter),vec2(1.0-gutter),mirrored);
  return texture(uEnvironment,(cell+inset)*0.5).rgb;
}`;
/** Signed hex distance + low-amplitude noise feather terrain into one shared sandy ground. */
export const fragmentSource = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTerrain;
uniform sampler2D uEnvironment;
uniform vec3 uLand[${MAX_TERRAIN_HEXES}];
uniform int uCount;
uniform vec4 uWorld;
uniform float uConcept;
${shaderFunctions}
void main(){
  vec2 p=uWorld.xy+vec2(vUv.x,1.0-vUv.y)*uWorld.zw;
  float land=10000.0;int nearest=0;
  for(int i=0;i<uCount;i++){float d=hex(p-uLand[i].xy,64.0);if(d<land){land=d;nearest=i;}}
  float angle=atan(p.y,p.x);
  float waterWidth=${WATER_BAND.toFixed(1)}${WATER_EDGE_WAVES.map((wave) => `+sin(angle*${wave.frequency.toFixed(1)}+${wave.phase.toFixed(2)})*${wave.amplitude.toFixed(2)}`).join('')};
  float outer=land-waterWidth;
  if(outer>=0.0){outColor=vec4(0);return;}
  float rough=(noise(p*0.13)-0.5)*3.0+(noise(p*0.043)-0.5)*3.0;
  vec2 waterUv=(p+vec2(470,430))/370.0;
  vec3 deep=environment(waterUv,vec2(0,0));
  vec3 shallow=environment(waterUv,vec2(1,0));
  vec3 color=mix(deep,shallow,1.0-smoothstep(10.0,69.0,land));
  float foam=(1.0-smoothstep(0.4,1.7,abs(land+rough-11.0)))*(0.35+noise(p*0.09)*0.4);
  color=mix(color,vec3(0.87,0.96,0.86),foam);
  vec3 sand=environment((p+vec2(600))/145.0,vec2(0,1));
  float coast=1.0-smoothstep(4.0,7.5,land+rough);
  float bankShade=mix(0.68,1.03,1.0-smoothstep(-2.0,6.0,land+rough));
  color=mix(color,sand*bankShade,coast);
  vec2 local=p-uLand[nearest].xy;
  float terrainEdge=hex(local,mix(58.5,57.0,uConcept))+rough*0.65;
  float terrainMask=1.0-smoothstep(-2.0,2.8,terrainEdge);
  float tile=uLand[nearest].z;
  vec2 cell=vec2(mod(tile,3.0),floor(tile/3.0));
  vec2 uv=clamp(local/128.0+0.5,vec2(0.004),vec2(0.996));
  vec3 terrain=texture(uTerrain,(cell+uv)/vec2(3.0,2.0)).rgb;
  float light=dot(terrain,vec3(0.2126,0.7152,0.0722));
  terrain=clamp((mix(vec3(light),terrain,0.94)-0.5)*0.94+0.54,0.0,1.0);
  color=mix(color,terrain,terrainMask);
  // Water becomes transparent over a broad band; no dark rim cuts it out of the table.
  outColor=vec4(color,1.0-smoothstep(-${WATER_FEATHER.toFixed(1)},0.0,outer));
}
`;
const glsl = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
/**
 * The same ground for a board with sea hexes: land draws its coast, shallows, foam and tiles exactly as above,
 * but the water fills the frame of every hex, land or sea, and fades into the table a little outside its rim,
 * along the frame's smooth outline rather than round each island.
 */
export const seaFragmentSource = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTerrain;
uniform sampler2D uEnvironment;
uniform sampler2D uGold;
uniform vec3 uLand[${MAX_TERRAIN_HEXES}];
uniform int uCount;
uniform vec4 uSea[${MAX_SEA_HEXES / 2}];
uniform int uSeaCount;
uniform vec4 uWorld;
uniform float uConcept;
${shaderFunctions}
// The open sea is far more water than Classic's band, and one mirrored tile of it repeats into a kaleidoscope.
// Every ${glsl(OPEN_WATER_PATCH)} units the deep water starts from its own place in the tile, blended into its neighbours.
vec3 openWater(vec2 p){
  vec2 q=p/${glsl(OPEN_WATER_PATCH)},i=floor(q),f=smoothstep(0.2,0.8,fract(q));
  vec3 w[4];
  for(int k=0;k<4;k++){vec2 c=i+vec2(k%2,k/2);w[k]=environment((p+vec2(470,430)+740.0*vec2(hash(c),hash(c+17.0)))/370.0,vec2(0,0));}
  return mix(mix(w[0],w[1],f.x),mix(w[2],w[3],f.x),f.y);
}
void main(){
  vec2 p=uWorld.xy+vec2(vUv.x,1.0-vUv.y)*uWorld.zw;
  // The frame is a smooth union of every hex: sums of exponentials, which round off the rim's corners.
  float land=10000.0,shoal=10000.0,shade=10000.0,frame=0.0;int nearest=0;
  for(int i=0;i<uCount;i++){
    float d=hex(p-uLand[i].xy,64.0);
    if(d<land){land=d;nearest=i;}
    // A polynomial smooth minimum: the nearest coast's distance, blended with any other within reach of it.
    float blend=max(${glsl(SHOAL_SMOOTHING)}-abs(shoal-d),0.0)/${glsl(SHOAL_SMOOTHING)};
    shoal=min(shoal,d)-blend*blend*${glsl(SHOAL_SMOOTHING / 4)};
    shade=min(shade,hex(p-vec2(0.0,${glsl(ISLAND_SHADOW.offset)})-uLand[i].xy,64.0));
    frame+=exp(-d/${glsl(SEA_SMOOTHING)});
  }
  for(int i=0;i<uSeaCount;i++){vec4 pair=uSea[i/2];frame+=exp(-hex(p-(i%2==0?pair.xy:pair.zw),64.0)/${glsl(SEA_SMOOTHING)});}
  float seaWidth=${glsl(SEA_BAND)}${SEA_EDGE_WAVES.map((wave) => `+sin(dot(p,vec2(${glsl(wave.x)},${glsl(wave.y)}))*${((2 * Math.PI) / wave.wavelength).toFixed(8)}+${wave.phase.toFixed(2)})*${wave.amplitude.toFixed(2)}`).join('')};
  float outer=-${glsl(SEA_SMOOTHING)}*log(frame)-seaWidth;
  if(outer>=0.0){outColor=vec4(0);return;}
  float rough=(noise(p*0.13)-0.5)*3.0+(noise(p*0.043)-0.5)*3.0;
  vec2 waterUv=(p+vec2(470,430))/370.0;
  vec3 deep=openWater(p);
  vec3 shallow=environment(waterUv,vec2(1,0));
  vec3 color=mix(deep,shallow,1.0-smoothstep(10.0,69.0,shoal));
  float foam=(1.0-smoothstep(0.4,1.7,abs(land+rough-11.0)))*(0.35+noise(p*0.09)*0.4);
  color=mix(color,vec3(0.87,0.96,0.86),foam);
  // Each island casts the stage's drop shadow onto the water round it, so the sea's own edge needs none.
  color=mix(color,vec3(${ISLAND_SHADOW.colour.map((c) => (c / 255).toFixed(4)).join(',')}),${ISLAND_SHADOW.opacity.toFixed(2)}*(1.0-smoothstep(${glsl(ISLAND_SHADOW.edge - ISLAND_SHADOW.blur)},${glsl(ISLAND_SHADOW.edge + ISLAND_SHADOW.blur)},shade)));
  vec3 sand=environment((p+vec2(600))/145.0,vec2(0,1));
  float coast=1.0-smoothstep(4.0,7.5,land+rough);
  float bankShade=mix(0.68,1.03,1.0-smoothstep(-2.0,6.0,land+rough));
  color=mix(color,sand*bankShade,coast);
  vec2 local=p-uLand[nearest].xy;
  float terrainEdge=hex(local,mix(58.5,57.0,uConcept))+rough*0.65;
  float terrainMask=1.0-smoothstep(-2.0,2.8,terrainEdge);
  float tile=uLand[nearest].z;
  vec2 uv=clamp(local/128.0+0.5,vec2(0.004),vec2(0.996));
  // A gold field's picture is a texture of its own, past the atlas's six cells.
  vec3 terrain=tile>${glsl(GOLD_TILE - 0.5)}?texture(uGold,uv).rgb:texture(uTerrain,(vec2(mod(tile,3.0),floor(tile/3.0))+uv)/vec2(3.0,2.0)).rgb;
  float light=dot(terrain,vec3(0.2126,0.7152,0.0722));
  terrain=clamp((mix(vec3(light),terrain,0.94)-0.5)*0.94+0.54,0.0,1.0);
  color=mix(color,terrain,terrainMask);
  outColor=vec4(color,1.0-smoothstep(-${WATER_FEATHER.toFixed(1)},0.0,outer));
}
`;
function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error ?? 'Shader compile failed');
  }
  return shader;
}
/** A board theme's pictures: the terrain atlas, the water and sand, and the gold field's own tile. */
export type TerrainArt = { terrain: string; environment: string; concept?: boolean; gold?: string };
export function Terrain({
  board,
  onReady,
  art,
}: {
  board: Board;
  onReady: (ready: boolean) => void;
  art?: TerrainArt;
}) {
  const terrainArt = art?.terrain ?? TERRAIN_ART,
    environmentArt = art?.environment ?? ENVIRONMENT_ART,
    goldArt = art?.gold ?? GOLD_ART;
  const concept = art?.concept ?? false;
  const ref = useRef<HTMLCanvasElement>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const canvas = ref.current!;
    let disposed = false;
    let cleanup = () => {};
    onReady(false);
    const lost = (e: Event) => {
      e.preventDefault();
      onReady(false);
    };
    const restored = () => setGeneration((n) => n + 1);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    async function start() {
      const gl = canvas.getContext('webgl2', {
        antialias: false,
        alpha: true,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
      });
      if (!gl) return;
      // A board too big for the shader stops here, before any work, and the SVG ground stands in.
      const uniforms = terrainUniforms(board),
        sea = hasSea(board);
      // The gold field's tile loads only for a board that has one.
      const gold = board.hexes.some((h) => TERRAIN_INDEX[h.terrain] === GOLD_TILE);
      const images = await Promise.all(
        [terrainArt, environmentArt, ...(gold ? [goldArt] : [])].map(decodedGameImage),
      );
      if (disposed || gl.isContextLost()) return;
      const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource),
        fragment = compile(gl, gl.FRAGMENT_SHADER, sea ? seaFragmentSource : fragmentSource);
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        throw new Error('Terrain shader link failed');
      }
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const attribute = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      const textures = images.map((image, i) => {
        const texture = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        return texture;
      });
      gl.uniform1f(gl.getUniformLocation(program, 'uConcept'), concept ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(program, 'uTerrain'), 0);
      gl.uniform1i(gl.getUniformLocation(program, 'uEnvironment'), 1);
      gl.uniform3fv(gl.getUniformLocation(program, 'uLand[0]'), uniforms.land);
      gl.uniform1i(gl.getUniformLocation(program, 'uCount'), uniforms.count);
      const { world } = uniforms;
      gl.uniform4f(gl.getUniformLocation(program, 'uWorld'), world.x, world.y, world.width, world.height);
      if (sea) {
        gl.uniform1i(gl.getUniformLocation(program, 'uGold'), 2);
        gl.uniform4fv(gl.getUniformLocation(program, 'uSea[0]'), uniforms.sea);
        gl.uniform1i(gl.getUniformLocation(program, 'uSeaCount'), uniforms.seaCount);
      }
      const draw = () => {
        if (disposed || gl.isContextLost()) return;
        const ratio = Math.min(devicePixelRatio || 1, 2),
          rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(rect.width * ratio));
        canvas.height = Math.max(1, Math.round(rect.height * ratio));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        onReady(true);
      };
      const observer = new ResizeObserver(draw);
      observer.observe(canvas);
      draw();
      cleanup = () => {
        observer.disconnect();
        textures.forEach((t) => gl.deleteTexture(t));
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      };
    }
    void start().catch((error) => {
      if (!disposed) {
        onReady(false);
        console.warn('Terrain renderer unavailable; using SVG fallback.', error);
      }
    });
    return () => {
      disposed = true;
      cleanup();
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
    // A board never changes once dealt, so this runs once per boardKey. Game actions must not re-upload textures.
  }, [boardKey(board), generation, onReady, terrainArt, environmentArt, goldArt, concept]);
  return <canvas ref={ref} className="terrain-canvas" aria-hidden="true" />;
}
