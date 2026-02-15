import svgPaths from "./svg-v1yr43xgtu";
import imgRectangle1 from "figma:asset/56f453b1d7e0f5fec7770949c021dfbcdf9ae9d3.png";
import { imgRectangle } from "./svg-ihon1";

function Group() {
  return (
    <div className="absolute contents inset-[8.52%_4.77%_34.53%_63.45%]" data-name="Group">
      <div className="absolute inset-[8.52%_4.77%_34.53%_63.45%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[0px] mask-size-[610.225px_615.039px]" data-name="Rectangle" style={{ maskImage: `url('${imgRectangle}')` }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img alt="" className="absolute left-0 max-w-none size-full top-0" src={imgRectangle1} />
        </div>
      </div>
    </div>
  );
}

function ClipPathGroup() {
  return (
    <div className="absolute contents inset-[8.52%_4.77%_34.53%_63.45%]" data-name="Clip path group">
      <Group />
    </div>
  );
}

export default function Frame() {
  return (
    <div className="bg-[#121e3c] relative size-full" data-name="Frame">
      <div className="absolute inset-[73.45%_0.01%_-0.04%_-0.33%]" data-name="Vector">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1927 288">
          <path d={svgPaths.p2c082900} fill="var(--fill-0, black)" id="Vector" />
        </svg>
      </div>
      <div className="absolute inset-[82.53%_89.57%_9.04%_5.69%]" data-name="Vector">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 92 92">
          <path clipRule="evenodd" d={svgPaths.p5e26900} fill="var(--fill-0, #71F424)" fillRule="evenodd" id="Vector" />
        </svg>
      </div>
      <div className="absolute inset-[82.53%_83.34%_9.04%_11.91%]" data-name="Vector">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 92 92">
          <path clipRule="evenodd" d={svgPaths.p5e26900} fill="var(--fill-0, #71F424)" fillRule="evenodd" id="Vector" />
        </svg>
      </div>
      <div className="absolute inset-[82.53%_77.1%_9.04%_18.16%]" data-name="Vector">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 92 92">
          <path clipRule="evenodd" d={svgPaths.p3465a000} fill="var(--fill-0, #71F424)" fillRule="evenodd" id="Vector" />
        </svg>
      </div>
      <div className="absolute inset-[84.84%_90.89%_11.35%_6.99%]" data-name="Vector">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 41 42">
          <path clipRule="evenodd" d={svgPaths.p1f8a2680} fill="var(--fill-0, #141311)" fillRule="evenodd" id="Vector" />
        </svg>
      </div>
      <div className="absolute inset-[84.88%_84.67%_11.35%_13.24%]" data-name="Vector">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 41 41">
          <path clipRule="evenodd" d={svgPaths.p1aceaf00} fill="var(--fill-0, #141311)" fillRule="evenodd" id="Vector" />
        </svg>
      </div>
      <ClipPathGroup />
      <p className="absolute bottom-1/2 font-['Manrope:Regular',_sans-serif] font-normal leading-[1.2] left-[5.68%] right-[53.38%] text-[150px] text-white top-[16.67%] tracking-[-3px]">Contact Information</p>
      <p className="absolute font-['Manrope:Regular',_sans-serif] font-normal inset-[58.52%_63.54%_35%_5.68%] leading-[1.75] text-[20px] text-white tracking-[-0.4px]">{`Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. `}</p>
      <p className="absolute font-['Manrope:Regular',_sans-serif] font-normal inset-[84.44%_57.45%_12.31%_29.06%] leading-[1.75] text-[20px] text-white tracking-[-0.4px]">www.brandymarketing.com</p>
      <div className="absolute font-['Manrope:Regular',_sans-serif] font-normal inset-[81.2%_23.07%_9.07%_63.44%] leading-[1.75] text-[20px] text-white tracking-[-0.4px]">
        <p className="mb-0">+1 1243 1231445</p>
        <p className="mb-0">123 Scott Street, Mybank</p>
        <p>San Diego, CA</p>
      </div>
      <div className="absolute inset-[85.09%_78.65%_11.52%_19.64%]" data-name="Vector">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 33 37">
          <path clipRule="evenodd" d={svgPaths.p256f3000} fill="var(--fill-0, #141311)" fillRule="evenodd" id="Vector" />
        </svg>
      </div>
    </div>
  );
}