import { useEffect, useRef, useState } from 'react';
import type { Board } from '../../../packages/rules/src/board.js';
import { HEX_SIZE, oceanRing, oceanBoundary, TERRAIN_INDEX, WORLD } from './scene.js';

const vertexSource = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main(){ vUv=(aPosition+1.0)*0.5; gl_Position=vec4(aPosition,0.0,1.0); }
`;
/** Signed hex distance + low-amplitude noise feather terrain into one shared sandy ground. */
export const fragmentSource = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTerrain;
uniform sampler2D uEnvironment;
uniform vec3 uLand[19];
uniform vec2 uSea[18];
uniform vec4 uRim[42];
uniform vec4 uWorld;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float hex(vec2 p,float r){p=abs(p);return max(p.x,dot(p,vec2(0.5,0.8660254)))-0.8660254*r;}
float segment(vec2 p,vec4 edge){vec2 d=edge.zw-edge.xy;return length(p-edge.xy-d*clamp(dot(p-edge.xy,d)/dot(d,d),0.0,1.0));}
vec3 environment(vec2 uv,vec2 cell){return texture(uEnvironment,(cell+clamp(uv,vec2(0.002),vec2(0.998)))*0.5).rgb;}
void main(){
  vec2 p=uWorld.xy+vec2(vUv.x,1.0-vUv.y)*uWorld.zw;
  float land=10000.0,sea=10000.0;int nearest=0;
  for(int i=0;i<19;i++){float d=hex(p-uLand[i].xy,64.0);if(d<land){land=d;nearest=i;}}
  for(int i=0;i<18;i++){sea=min(sea,hex(p-uSea[i],64.0));}
  float outer=min(land,sea);
  if(outer>6.0){outColor=vec4(0);return;}
  float rough=(noise(p*0.13)-0.5)*3.0+(noise(p*0.043)-0.5)*3.0;
  vec2 waterUv=fract((p+vec2(470,430))/370.0);
  vec3 deep=environment(waterUv,vec2(0,0));
  vec3 shallow=environment(waterUv,vec2(1,0));
  vec3 color=mix(deep,shallow,1.0-smoothstep(10.0,69.0,land));
  // Clear ocean hex geometry sits outside the organic coast.
  float seam=(1.0-smoothstep(0.25,1.35,abs(sea)))*smoothstep(15.0,25.0,land);
  color=mix(color,vec3(0.40,0.77,0.80),seam*0.30);
  float foam=(1.0-smoothstep(0.4,1.7,abs(land+rough-11.0)))*(0.35+noise(p*0.09)*0.4);
  color=mix(color,vec3(0.87,0.96,0.86),foam);
  vec3 sand=environment(fract((p+vec2(600))/145.0),vec2(0,1));
  float coast=1.0-smoothstep(4.0,7.5,land+rough);
  float bankShade=mix(0.68,1.03,1.0-smoothstep(-2.0,6.0,land+rough));
  color=mix(color,sand*bankShade,coast);
  vec2 local=p-uLand[nearest].xy;
  float terrainEdge=hex(local,58.5)+rough*0.65;
  float terrainMask=1.0-smoothstep(-2.0,2.8,terrainEdge);
  float tile=uLand[nearest].z;
  vec2 cell=vec2(mod(tile,3.0),floor(tile/3.0));
  vec2 uv=clamp(local/128.0+0.5,vec2(0.004),vec2(0.996));
  vec3 terrain=texture(uTerrain,(cell+uv)/vec2(3.0,2.0)).rgb;
  float light=dot(terrain,vec3(0.2126,0.7152,0.0722));
  terrain=clamp((mix(vec3(light),terrain,0.94)-0.5)*0.94+0.54,0.0,1.0);
  color=mix(color,terrain,terrainMask);
  // The outer ocean ring has a quiet physical rim against the wooden table.
  float boundary=10000.0;
  if(outer>-2.0){for(int i=0;i<42;i++){boundary=min(boundary,segment(p,uRim[i]));}}
  float silhouette=outer>0.05?boundary:-boundary;
  float rim=smoothstep(-1.3,0.2,silhouette);
  color=mix(color,vec3(0.30,0.26,0.18),rim*0.8);
  outColor=vec4(color,1.0-smoothstep(0.5,3.0,silhouette));
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
export function Terrain({ board, onReady }: { board: Board; onReady: (ready: boolean) => void }) {
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
      const images = await Promise.all(
        ['/art/terrain-painted.png', '/art/environment-painted.png'].map(async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          return image;
        }),
      );
      if (disposed || gl.isContextLost()) return;
      const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource),
        fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
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
      gl.uniform1i(gl.getUniformLocation(program, 'uTerrain'), 0);
      gl.uniform1i(gl.getUniformLocation(program, 'uEnvironment'), 1);
      gl.uniform3fv(
        gl.getUniformLocation(program, 'uLand[0]'),
        new Float32Array(
          board.hexes.flatMap((h) => [h.x * HEX_SIZE, h.y * HEX_SIZE, TERRAIN_INDEX[h.terrain]]),
        ),
      );
      gl.uniform2fv(
        gl.getUniformLocation(program, 'uSea[0]'),
        new Float32Array(oceanRing().flatMap((h) => [h.x, h.y])),
      );
      gl.uniform4fv(gl.getUniformLocation(program, 'uRim[0]'), new Float32Array(oceanBoundary().flat()));
      gl.uniform4f(gl.getUniformLocation(program, 'uWorld'), WORLD.x, WORLD.y, WORLD.width, WORLD.height);
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
    // Board terrain is immutable for a seed. Game actions must not re-upload textures.
  }, [board.seed, generation, onReady]);
  return <canvas ref={ref} className="terrain-canvas" aria-hidden="true" />;
}
