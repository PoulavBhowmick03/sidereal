// SPDX-License-Identifier: Apache-2.0

declare module "*.png" {
  import type { StaticImageData } from "next/image";

  const src: StaticImageData;
  export default src;
}
