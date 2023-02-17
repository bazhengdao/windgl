import buble from "@rollup/plugin-buble";
import pkg from "./package.json" assert {type: 'json'};// 需要assert {type: 'json'}，否则npm提示异常。
import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";

import { compile as glslify } from "glslify";
import GLSLX from "glslx"; //需要把node_modules中的glslx加上“.js”后缀，否则npm提示异常。
import { dirname } from "path";
import { createFilter } from "rollup-pluginutils";

function makeGLSL(userOptions = {}) {
  const options = Object.assign(
    {
      include: [
        "**/*.vs",
        "**/*.fs",
        "**/*.vert",
        "**/*.frag",
        "**/*.glsl",
        "**/*.glslx"
      ]
    },
    userOptions
  );

  const filter = createFilter(options.include, options.exclude);

  return {
    transform(code, id) {
      if (!filter(id)) return;

      options.basedir = options.basedir || dirname(id);

      const codeWithDeps = glslify(code, options).replace(
        "#define GLSLIFY 1\n",
        ""
      );

      const compiled = GLSLX.compile(codeWithDeps, {
        disableRewriting: false,
        format: "json",
        keepSymbols: false,
        prettyPrint: false,
        renaming: "internal-only"
      });

      if (compiled.log) {
        return this.error(compiled.log.replace("<stdin>", id));
      }

      const program = JSON.parse(compiled.output);

      const {
        fragmentShaders,
        vertexShaders,
        otherShaders
      } = program.shaders.reduce(
        (obj, shader) => {
          if (shader.name.endsWith("Fragment")) {
            obj.fragmentShaders[shader.name.replace(/Fragment$/, "")] =
              shader.contents;
          } else if (shader.name.endsWith("Vertex")) {
            obj.vertexShaders[shader.name.replace(/Vertex$/, "")] =
              shader.contents;
          } else {
            obj.otherShaders[shader.name] = shader.contents;
          }
          return obj;
        },
        { fragmentShaders: {}, vertexShaders: {}, otherShaders: {} }
      );

      const assembledShaders = [];
      Object.keys(vertexShaders).forEach(key => {
        if (fragmentShaders[key]) {
          assembledShaders.push(
            `export const ${key} = gl => createProgram(gl, ${JSON.stringify(
              vertexShaders[key]
            )}, ${JSON.stringify(fragmentShaders[key])});`
          );
          delete fragmentShaders[key];
          delete vertexShaders[key];
        } else {
          assembledShaders.push(
            `export const ${key}Vertex = ${JSON.stringify(vertexShaders[key])};`
          );
        }
      });

      Object.keys(fragmentShaders).forEach(key => {
        assembledShaders.push(
          `export const ${key}Fragment = ${JSON.stringify(
            fragmentShaders[key]
          )};`
        );
      });

      Object.keys(otherShaders).forEach(key => {
        if (key === "main") {
          assembledShaders.push(
            `export default ${JSON.stringify(otherShaders[key])};`
          );
        } else {
          assembledShaders.push(
            `export const ${key} = ${JSON.stringify(otherShaders[key])};`
          );
        }
      });

      return {
        code: `import {createProgram} from "../util";

        ${assembledShaders.join("\n\n")}`,
        map: { mappings: "" }
      };
    }
  };
}

const plugins = [
  makeGLSL({ include: "./src/shaders/*.glsl" }),
  resolve(),
  commonjs(),
  buble({transforms: { forOf: false }})
];

export default [
  // demo和mapbox一起打包，有异常（i is constant），问了bing，说是commonjs和rollup之间的冲突（可能吧，本也不想这样打包，暂搁置此问题）。
  // {
  //   input: "demo.js",
  //   output: [{ file: "docs/index.js", format: "iife" }],
  //   plugins
  // },
  {
    input: "src/index.js",
    output: [
      { 
        file: pkg.browser, 
        format: "umd", 
        name: "windGL",
        // style-spec里的.cjs可以在html中通过script直接引用，但其全局变量名是mapboxGlStyleSpecification(是mapbox公司打包的)
        //如果不配置此globals，windGL打包的.umd.js中的全局变量名默认是styleSpec，使用时都得在引用windGL.umd.js之前设置一下 window.styleSpec = mapboxGlStyleSpecification
        globals: {
          "mapbox-gl/dist/style-spec": "mapboxGlStyleSpecification"                                                                     
        } 
      }
    ],
    plugins
  },
  {
    input: "src/index.js",
    output: [
      {
        file: pkg.main,
        format: "cjs"
      },
      {
        file: pkg.module,
        format: "es"
      }
    ],
    external: ["mapbox-gl/dist/style-spec"], // @rollup/plugin-node-resolve 此插件负责这里
    plugins
  }
];
