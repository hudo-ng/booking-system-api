import ImageKit from "imagekit";

export const imageKit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_URL as string,
  privateKey: process.env.IMAGEKIT_PRIVATE_URL as string,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT as string,
});
