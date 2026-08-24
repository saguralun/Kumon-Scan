
export function randomPick(arr){

  if(!Array.isArray(arr) || arr.length === 0){
    return null;
  }

  return arr[
    Math.floor(Math.random() * arr.length)
  ];

}

export function delay(ms){
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}