import svgPaths from "./svg-ik76jdycii";
import imgAvatar from "figma:asset/bd7c13233375885c0d32dc739e575d17db5a2201.png";
import imgImage7 from "figma:asset/f438047691c382addfed5c99dfc97977dea5c831.png";
import imgImage4 from "figma:asset/876ec040af4ae472e932818bce39f20ca0e1e282.png";
import { imgRectangle51, imgBaju } from "./svg-0tbt4";

function Frame() {
  return <div className="absolute left-[683px] size-[100px] top-[31px]" />;
}

function SecondaryArrowLeft() {
  return (
    <div className="absolute left-[331px] size-[30px] top-[90px]" data-name="Secondary / Arrow Left">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 30 30">
        <g id="Secondary / Arrow Left">
          <path clipRule="evenodd" d={svgPaths.p2327cef0} fill="var(--fill-0, #3C3F88)" fillRule="evenodd" id="Arrow 1 (Stroke)" />
        </g>
      </svg>
    </div>
  );
}

function Group9() {
  return (
    <div className="absolute contents left-[331px] top-[87px]">
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[374px] not-italic text-[24px] text-[rgba(27,26,26,0.65)] text-nowrap top-[87px] tracking-[1px] whitespace-pre">ICU AI</p>
      {[...Array(2).keys()].map((_, i) => (
        <SecondaryArrowLeft key={i} />
      ))}
    </div>
  );
}

function CoupleMessages() {
  return <div className="absolute bottom-[286.18px] h-[114.986px] left-[17.09px] right-[17.09px]" data-name="Couple Messages" />;
}

function Bubble() {
  return (
    <div className="bg-white relative rounded-bl-[17.085px] rounded-br-[17.085px] rounded-tl-[2.136px] rounded-tr-[17.085px] shrink-0" data-name="bubble">
      <div className="box-border content-stretch flex flex-col gap-[17.085px] items-start overflow-clip p-[17.085px] relative rounded-[inherit]">
        <p className="font-['Source_Sans_Pro:Regular',_sans-serif] h-[21.187px] leading-[normal] not-italic relative shrink-0 text-[17.085px] text-black w-[185.971px]">How can I help you today?</p>
      </div>
      <div aria-hidden="true" className="absolute border-[#e3e7ea] border-[1.068px] border-solid inset-0 pointer-events-none rounded-bl-[17.085px] rounded-br-[17.085px] rounded-tl-[2.136px] rounded-tr-[17.085px]" />
    </div>
  );
}

function MsgBubble() {
  return (
    <div className="content-stretch flex flex-col gap-[17.085px] items-start relative shrink-0" data-name="msg bubble">
      <Bubble />
    </div>
  );
}

function BotMessage() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[4.271px] items-start left-[17px] top-[2.57px] w-[1107.05px]" data-name="bot message">
      <MsgBubble />
    </div>
  );
}

function UserMessage() {
  return <div className="h-[55.357px] shrink-0 w-full" data-name="user message" />;
}

function QuickReply() {
  return (
    <div className="bg-white box-border content-stretch flex flex-col gap-[10.678px] items-start p-[12.814px] relative rounded-[12.814px] shrink-0" data-name="_quick reply">
      <div aria-hidden="true" className="absolute border-[#6a2498] border-[1.068px] border-solid inset-0 pointer-events-none rounded-[12.814px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)]" />
      <div className="flex flex-col font-['Source_Sans_Pro:Bold',_sans-serif] justify-center leading-[0] not-italic relative shrink-0 text-[#6a2498] text-[14.95px] text-center text-nowrap">
        <p className="leading-[1.4] whitespace-pre">I am a doctor</p>
      </div>
    </div>
  );
}

function QuickReply1() {
  return (
    <div className="bg-white box-border content-stretch flex flex-col gap-[10.678px] items-start p-[12.814px] relative rounded-[12.814px] shrink-0" data-name="_quick reply">
      <div aria-hidden="true" className="absolute border-[#6a2498] border-[1.068px] border-solid inset-0 pointer-events-none rounded-[12.814px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)]" />
      <div className="flex flex-col font-['Source_Sans_Pro:Bold',_sans-serif] justify-center leading-[0] not-italic relative shrink-0 text-[#6a2498] text-[14.95px] text-center text-nowrap">
        <p className="leading-[1.4] whitespace-pre">I am a pharmacist</p>
      </div>
    </div>
  );
}

function QuickReply2() {
  return (
    <div className="bg-white box-border content-stretch flex flex-col gap-[10.678px] items-start p-[12.814px] relative rounded-[12.814px] shrink-0" data-name="_quick reply">
      <div aria-hidden="true" className="absolute border-[#6a2498] border-[1.068px] border-solid inset-0 pointer-events-none rounded-[12.814px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)]" />
      <div className="flex flex-col font-['Source_Sans_Pro:Bold',_sans-serif] justify-center leading-[0] not-italic relative shrink-0 text-[#6a2498] text-[14.95px] text-center text-nowrap">
        <p className="leading-[1.4] whitespace-pre">I am a nurse</p>
      </div>
    </div>
  );
}

function Row() {
  return (
    <div className="content-stretch flex gap-[8.543px] items-start justify-end relative shrink-0" data-name="_row">
      <QuickReply />
      <QuickReply1 />
      <QuickReply2 />
    </div>
  );
}

function QuickReplies() {
  return (
    <div className="box-border content-stretch flex flex-col gap-[8.543px] h-[59px] items-end justify-center pb-0 pt-[12.814px] px-0 relative shrink-0 w-[384px]" data-name="quick replies">
      <Row />
    </div>
  );
}

function BotMessage1() {
  return (
    <div className="content-stretch flex flex-col gap-[4.271px] items-start relative shrink-0 w-full" data-name="bot message">
      <QuickReplies />
    </div>
  );
}

function CoupleMessages1() {
  return (
    <div className="absolute bottom-[17.09px] content-stretch flex flex-col gap-[17.085px] items-start left-[17.09px] right-[17.09px]" data-name="Couple Messages">
      <UserMessage />
      <BotMessage1 />
    </div>
  );
}

function Bubble1() {
  return (
    <div className="bg-[#6a2498] box-border content-stretch flex flex-col gap-[17.085px] items-start overflow-clip p-[17.085px] relative rounded-[17.085px] shrink-0" data-name="bubble">
      <p className="font-['Source_Sans_Pro:Regular',_sans-serif] h-[21.187px] leading-[normal] not-italic relative shrink-0 text-[17.085px] text-white w-[37.665px]">Hello</p>
    </div>
  );
}

function MsgBubble1() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[17.085px] items-start left-[1052px] rounded-[17.085px] top-[87.57px]" data-name="msg bubble">
      <Bubble1 />
    </div>
  );
}

function Thread() {
  return (
    <div className="absolute bg-[#f9f9fb] bottom-[76.86px] left-0 overflow-x-clip overflow-y-auto right-[-0.23px] top-[85.43px]" data-name="thread">
      <CoupleMessages />
      <BotMessage />
      <CoupleMessages1 />
      <MsgBubble1 />
    </div>
  );
}

function InputField() {
  return (
    <div className="basis-0 grow h-full min-h-px min-w-px relative shrink-0" data-name="input field">
      <div className="flex flex-row items-center size-full">
        <div className="box-border content-stretch flex gap-[12.814px] items-center pl-[17.085px] pr-[8.543px] py-[9.611px] relative size-full">
          <p className="font-['Source_Sans_Pro:Regular',_sans-serif] h-[23.492px] leading-[1.4] not-italic relative shrink-0 text-[#a0aaae] text-[0px] text-[17.085px] w-[153.769px]">
            <span className="text-white">|</span>Type your message...
          </p>
        </div>
      </div>
    </div>
  );
}

function Send() {
  return (
    <div className="relative shrink-0 size-[25.628px]" data-name="send">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 26 26">
        <g id="send">
          <path d={svgPaths.p379bf600} fill="var(--fill-0, #A0AAAE)" id="Mask" />
        </g>
      </svg>
    </div>
  );
}

function NavbarsIconButton() {
  return (
    <div className="box-border content-stretch flex items-center justify-center overflow-clip p-[4.271px] relative rounded-[17.085px] shrink-0" data-name="Navbars/Icon button">
      <Send />
    </div>
  );
}

function SendButton() {
  return (
    <div className="content-stretch flex gap-[12.814px] items-center justify-center relative shrink-0 size-[76.884px]" data-name="Send button">
      <NavbarsIconButton />
    </div>
  );
}

function SearchAndActions() {
  return (
    <div className="content-stretch flex h-[76.884px] items-center relative shrink-0 w-full" data-name="Search and actions">
      <InputField />
      <SendButton />
    </div>
  );
}

function MsgInput() {
  return (
    <div className="absolute bg-white bottom-[-0.02px] content-stretch flex flex-col items-start justify-end left-0 right-[-0.23px] rounded-bl-[17.085px] rounded-br-[17.085px]" data-name="msg input">
      <SearchAndActions />
      <div className="absolute inset-0 pointer-events-none shadow-[0px_1.068px_0px_0px_inset_#a0aaae]" />
    </div>
  );
}

function Avatar() {
  return (
    <div className="relative rounded-[106.784px] shrink-0 size-[42.714px]" data-name="avatar">
      <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[106.784px] size-full" src={imgAvatar} />
    </div>
  );
}

function Text() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Text">
      <p className="font-['Source_Sans_Pro:Bold',_sans-serif] h-[21.187px] leading-[normal] not-italic relative shrink-0 text-[17.085px] text-black w-[121.234px]">ChatICU</p>
    </div>
  );
}

function BlogSectionsAvatarWithText() {
  return (
    <div className="basis-0 content-stretch flex gap-[12.814px] grow items-center min-h-px min-w-px relative shrink-0" data-name="Blog Sections/Avatar with text">
      <Avatar />
      <Text />
    </div>
  );
}

function DotsVertical() {
  return (
    <div className="absolute left-[4.27px] size-[34.171px] top-[4.27px]" data-name="Dots vertical">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 35 35">
        <g id="Dots vertical">
          <g id="Icon">
            <path d={svgPaths.p13e93f80} fill="var(--fill-0, #565E62)" />
            <path d={svgPaths.p35075a00} fill="var(--fill-0, #565E62)" />
            <path d={svgPaths.p3ba7800} fill="var(--fill-0, #565E62)" />
            <path d={svgPaths.p172ed7b0} stroke="var(--stroke-0, #565E62)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.13568" />
          </g>
        </g>
      </svg>
    </div>
  );
}

function MoreOptions() {
  return (
    <div className="relative rounded-[21.357px] shrink-0 size-[42.714px]" data-name="More options">
      <DotsVertical />
    </div>
  );
}

function X() {
  return (
    <div className="absolute left-[4.27px] size-[34.171px] top-[4.27px]" data-name="X">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 35 35">
        <g id="X">
          <path d={svgPaths.p24d9f280} id="Icon" stroke="var(--stroke-0, #565E62)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.13568" />
        </g>
      </svg>
    </div>
  );
}

function CloseChat() {
  return (
    <div className="relative rounded-[21.357px] shrink-0 size-[42.714px]" data-name="Close Chat">
      <X />
    </div>
  );
}

function IconicActions() {
  return (
    <div className="content-stretch flex gap-[12.814px] items-start relative shrink-0" data-name="Iconic Actions">
      <MoreOptions />
      <CloseChat />
    </div>
  );
}

function ChatHeader() {
  return (
    <div className="absolute bg-[#f9f9fb] box-border content-stretch flex items-center left-0 p-[17.085px] right-[-0.23px] rounded-tl-[25.628px] rounded-tr-[25.628px] top-0" data-name="chat header">
      <BlogSectionsAvatarWithText />
      <IconicActions />
    </div>
  );
}

function Chat() {
  return (
    <div className="absolute bg-[#f9f9fb] h-[771px] left-1/2 overflow-clip rounded-[25.628px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)] top-[calc(50%+33.5px)] translate-x-[-50%] translate-y-[-50%] w-[1141px]" data-name="CHAT">
      <Thread />
      <MsgInput />
      <ChatHeader />
      <div className="absolute left-[17px] size-[44px] top-[16px]" data-name="image 7">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage7} />
      </div>
    </div>
  );
}

function Group3() {
  return (
    <div className="absolute inset-[8.33%_37.5%_12.5%_41.67%]">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 5 19">
        <g id="Group 52">
          <path clipRule="evenodd" d={svgPaths.p29162280} fill="var(--fill-0, #FF16A2)" fillRule="evenodd" id="Ellipse 12 (Stroke)" />
          <path clipRule="evenodd" d={svgPaths.p1c16a040} fill="var(--fill-0, #FF16A2)" fillRule="evenodd" id="Vector 59 (Stroke)" />
        </g>
      </svg>
    </div>
  );
}

function SecondaryNotification() {
  return (
    <div className="absolute left-[1037px] overflow-clip size-[24px] top-[3px]" data-name="Secondary / Notification">
      <Group3 />
    </div>
  );
}

function SecondarySettings() {
  return <div className="absolute left-[993px] size-[24px] top-[3px]" data-name="Secondary / Settings" />;
}

function MaskGroup() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <div className="absolute bottom-0 left-[2.4%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.441px_0px] mask-size-[18.373px_11.024px] right-[-2.4%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFB7A0)" id="Rectangle 51" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-[4.8%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.882px_0px] mask-size-[18.373px_11.024px] right-[-4.8%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="url(#paint0_linear_5_3149)" id="Rectangle 52" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3149" x1="9.18639" x2="9.18639" y1="0" y2="6.39373">
              <stop stopColor="#FFAF8D" />
              <stop offset="1" stopColor="#FFB672" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute flex h-[calc(1px*((var(--transform-inner-width)*0.5)+(var(--transform-inner-height)*0.8660253882408142)))] items-center justify-center left-[99px] top-[126px] w-[calc(1px*((var(--transform-inner-height)*0.5)+(var(--transform-inner-width)*0.8660253882408142)))]" style={{ "--transform-inner-width": "48", "--transform-inner-height": "21.96875" } as React.CSSProperties}>
        <div className="flex-none rotate-[30deg]">
          <div className="h-[22px] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-99px_-126px] mask-size-[18.373px_11.024px] relative w-[48px]" style={{ maskImage: `url('${imgRectangle51}')` }}>
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 48 22">
              <path d={svgPaths.p8965e00} fill="url(#paint0_linear_5_3155)" id="Vector 74" />
              <defs>
                <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3155" x1="-41.8292" x2="42.2035" y1="8.05883" y2="12.9934">
                  <stop stopColor="white" />
                  <stop offset="1" stopColor="white" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Baju() {
  return (
    <div className="absolute inset-[66.59%_14.99%_-3.33%_23.77%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-7.13px_-19.976px] mask-size-[30px_30px] overflow-clip" data-name="Baju" style={{ maskImage: `url('${imgBaju}')` }}>
      <div className="absolute inset-0">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFD4C7)" id="Rectangle 49" />
        </svg>
      </div>
      <MaskGroup />
      <div className="absolute inset-[60%_76.4%_-2%_21.2%]" data-name="Vector 72 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p340d2200} fill="url(#paint0_linear_5_3195)" fillRule="evenodd" id="Vector 72 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3195" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute inset-[60%_23.6%_-2%_74%]" data-name="Vector 73 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p1f806700} fill="url(#paint0_linear_5_3130)" fillRule="evenodd" id="Vector 73 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3130" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

function Leher() {
  return (
    <div className="absolute bottom-0 left-[36.55%] right-[37.44%] top-[63.54%]" data-name="Leher">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 4 6">
        <g id="Leher">
          <path d={svgPaths.p1dc1b8c0} fill="var(--fill-0, #FBC6D7)" id="Leher_2" />
          <g id="Mask Group">
            <mask height="6" id="mask0_5_3120" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="4" x="0" y="0">
              <path d={svgPaths.p3802d100} fill="var(--fill-0, #FF7CA6)" id="Leher_3" />
            </mask>
            <g mask="url(#mask0_5_3120)">
              <path d={svgPaths.p1a240470} fill="var(--fill-0, #FF7CA6)" id="Leher_4" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

function Kepala() {
  return (
    <div className="absolute bottom-[27.08%] left-0 right-0 top-0" data-name="Kepala">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14 12">
        <g id="Kepala">
          <g id="Kuping  kiri">
            <path d={svgPaths.p1c026200} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21" />
            <path d={svgPaths.p22e3080} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22" />
          </g>
          <g id="Kuping  kiri_2">
            <path d={svgPaths.p3804de40} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21_2" />
            <path d={svgPaths.p2d287ac0} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22_2" />
          </g>
          <path d={svgPaths.p2b5ee800} fill="var(--fill-0, #FBC6D7)" id="Kepala_2" />
          <g id="Mask Group">
            <mask height="12" id="mask0_5_3098" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="11" x="1" y="0">
              <path d={svgPaths.p38702500} fill="var(--fill-0, #FBC6D7)" id="Kepala_3" />
            </mask>
            <g mask="url(#mask0_5_3098)">
              <path d={svgPaths.p1b2b880} fill="var(--fill-0, #FF5E5E)" id="Ellipse 26" />
              <path d={svgPaths.p15b66900} fill="var(--fill-0, #FF5E5E)" id="Ellipse 27" />
            </g>
          </g>
          <path clipRule="evenodd" d={svgPaths.p2939d900} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 75 (Stroke)" />
          <g id="Group 103">
            <path d={svgPaths.p3e62a000} fill="var(--fill-0, #3B2144)" id="Ellipse 28" />
            <path d={svgPaths.p303da200} fill="var(--fill-0, #3B2144)" id="Ellipse 29" />
          </g>
          <path clipRule="evenodd" d={svgPaths.p28566a30} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 76 (Stroke)" />
        </g>
      </svg>
    </div>
  );
}

function Kepala1() {
  return (
    <div className="absolute inset-[20.42%_24.38%_28%_32.2%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-9.659px_-6.125px] mask-size-[30px_30px] overflow-clip" data-name="Kepala" style={{ maskImage: `url('${imgBaju}')` }}>
      <Leher />
      <Kepala />
    </div>
  );
}

function Group4() {
  return (
    <div className="absolute contents inset-[10%_14.99%_-3.33%_16.67%]">
      <Baju />
      <Kepala1 />
      <div className="absolute inset-[32.66%_35.69%_65.14%_58.19%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-17.456px_-9.798px] mask-size-[30px_30px]" data-name="Vector 77 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p2b2fe200} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 77 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[33.15%_51.61%_64.65%_42.26%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-12.679px_-9.945px] mask-size-[30px_30px]" data-name="Vector 78 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p1cbb4c00} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 78 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[10%_46.41%_24.38%_16.67%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-5px_-3px] mask-size-[30px_30px]" data-name="Subtract" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 20">
          <path d={svgPaths.p3588b800} fill="var(--fill-0, #3D0525)" id="Subtract" />
        </svg>
      </div>
      <div className="absolute inset-[14.63%_28.22%_50.36%_34.18%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-10.255px_-4.389px] mask-size-[30px_30px]" data-name="Union" style={{ maskImage: `url('${imgBaju}')` }}>
        <div className="absolute bottom-[0.01%] left-0 right-0 top-0">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 11">
            <path d={svgPaths.p38c5e700} fill="var(--fill-0, #4C062E)" id="Union" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function MaskGroup1() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <Group4 />
    </div>
  );
}

function Foto() {
  return (
    <div className="absolute left-[1081px] size-[30px] top-0" data-name="Foto 1">
      <div className="absolute bg-[#d9c8ff] left-0 rounded-[5px] size-[30px] top-0" />
      <MaskGroup1 />
    </div>
  );
}

function MaskGroup2() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <div className="absolute bottom-0 left-[2.4%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.441px_0px] mask-size-[18.373px_11.024px] right-[-2.4%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFB7A0)" id="Rectangle 51" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-[4.8%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.882px_0px] mask-size-[18.373px_11.024px] right-[-4.8%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="url(#paint0_linear_5_3149)" id="Rectangle 52" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3149" x1="9.18639" x2="9.18639" y1="0" y2="6.39373">
              <stop stopColor="#FFAF8D" />
              <stop offset="1" stopColor="#FFB672" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute flex h-[calc(1px*((var(--transform-inner-width)*0.5)+(var(--transform-inner-height)*0.8660253882408142)))] items-center justify-center left-[99px] top-[126px] w-[calc(1px*((var(--transform-inner-height)*0.5)+(var(--transform-inner-width)*0.8660253882408142)))]" style={{ "--transform-inner-width": "48", "--transform-inner-height": "21.96875" } as React.CSSProperties}>
        <div className="flex-none rotate-[30deg]">
          <div className="h-[22px] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-99px_-126px] mask-size-[18.373px_11.024px] relative w-[48px]" style={{ maskImage: `url('${imgRectangle51}')` }}>
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 48 22">
              <path d={svgPaths.p8965e00} fill="url(#paint0_linear_5_3155)" id="Vector 74" />
              <defs>
                <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3155" x1="-41.8292" x2="42.2035" y1="8.05883" y2="12.9934">
                  <stop stopColor="white" />
                  <stop offset="1" stopColor="white" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Baju1() {
  return (
    <div className="absolute inset-[66.59%_14.99%_-3.33%_23.77%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-7.13px_-19.976px] mask-size-[30px_30px] overflow-clip" data-name="Baju" style={{ maskImage: `url('${imgBaju}')` }}>
      <div className="absolute inset-0">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFD4C7)" id="Rectangle 49" />
        </svg>
      </div>
      <MaskGroup2 />
      <div className="absolute inset-[60%_76.4%_-2%_21.2%]" data-name="Vector 72 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p340d2200} fill="url(#paint0_linear_5_3195)" fillRule="evenodd" id="Vector 72 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3195" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute inset-[60%_23.6%_-2%_74%]" data-name="Vector 73 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p1f806700} fill="url(#paint0_linear_5_3130)" fillRule="evenodd" id="Vector 73 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3130" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

function Leher1() {
  return (
    <div className="absolute bottom-0 left-[36.55%] right-[37.44%] top-[63.54%]" data-name="Leher">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 4 6">
        <g id="Leher">
          <path d={svgPaths.p1dc1b8c0} fill="var(--fill-0, #FBC6D7)" id="Leher_2" />
          <g id="Mask Group">
            <mask height="6" id="mask0_5_3120" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="4" x="0" y="0">
              <path d={svgPaths.p3802d100} fill="var(--fill-0, #FF7CA6)" id="Leher_3" />
            </mask>
            <g mask="url(#mask0_5_3120)">
              <path d={svgPaths.p1a240470} fill="var(--fill-0, #FF7CA6)" id="Leher_4" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

function Kepala2() {
  return (
    <div className="absolute bottom-[27.08%] left-0 right-0 top-0" data-name="Kepala">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14 12">
        <g id="Kepala">
          <g id="Kuping  kiri">
            <path d={svgPaths.p1c026200} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21" />
            <path d={svgPaths.p22e3080} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22" />
          </g>
          <g id="Kuping  kiri_2">
            <path d={svgPaths.p3804de40} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21_2" />
            <path d={svgPaths.p2d287ac0} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22_2" />
          </g>
          <path d={svgPaths.p2b5ee800} fill="var(--fill-0, #FBC6D7)" id="Kepala_2" />
          <g id="Mask Group">
            <mask height="12" id="mask0_5_3098" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="11" x="1" y="0">
              <path d={svgPaths.p38702500} fill="var(--fill-0, #FBC6D7)" id="Kepala_3" />
            </mask>
            <g mask="url(#mask0_5_3098)">
              <path d={svgPaths.p1b2b880} fill="var(--fill-0, #FF5E5E)" id="Ellipse 26" />
              <path d={svgPaths.p15b66900} fill="var(--fill-0, #FF5E5E)" id="Ellipse 27" />
            </g>
          </g>
          <path clipRule="evenodd" d={svgPaths.p2939d900} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 75 (Stroke)" />
          <g id="Group 103">
            <path d={svgPaths.p3e62a000} fill="var(--fill-0, #3B2144)" id="Ellipse 28" />
            <path d={svgPaths.p303da200} fill="var(--fill-0, #3B2144)" id="Ellipse 29" />
          </g>
          <path clipRule="evenodd" d={svgPaths.p28566a30} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 76 (Stroke)" />
        </g>
      </svg>
    </div>
  );
}

function Kepala3() {
  return (
    <div className="absolute inset-[20.42%_24.38%_28%_32.2%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-9.659px_-6.125px] mask-size-[30px_30px] overflow-clip" data-name="Kepala" style={{ maskImage: `url('${imgBaju}')` }}>
      <Leher1 />
      <Kepala2 />
    </div>
  );
}

function Group5() {
  return (
    <div className="absolute contents inset-[10%_14.99%_-3.33%_16.67%]">
      <Baju1 />
      <Kepala3 />
      <div className="absolute inset-[32.66%_35.69%_65.14%_58.19%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-17.456px_-9.798px] mask-size-[30px_30px]" data-name="Vector 77 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p2b2fe200} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 77 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[33.15%_51.61%_64.65%_42.26%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-12.679px_-9.945px] mask-size-[30px_30px]" data-name="Vector 78 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p1cbb4c00} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 78 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[10%_46.41%_24.38%_16.67%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-5px_-3px] mask-size-[30px_30px]" data-name="Subtract" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 20">
          <path d={svgPaths.p3588b800} fill="var(--fill-0, #3D0525)" id="Subtract" />
        </svg>
      </div>
      <div className="absolute inset-[14.63%_28.22%_50.36%_34.18%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-10.255px_-4.389px] mask-size-[30px_30px]" data-name="Union" style={{ maskImage: `url('${imgBaju}')` }}>
        <div className="absolute bottom-[0.01%] left-0 right-0 top-0">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 11">
            <path d={svgPaths.p38c5e700} fill="var(--fill-0, #4C062E)" id="Union" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function MaskGroup3() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <Group5 />
    </div>
  );
}

function Foto1() {
  return (
    <div className="absolute left-[1081px] size-[30px] top-0" data-name="Foto 2">
      <div className="absolute bg-[#d9c8ff] left-0 rounded-[5px] size-[30px] top-0" />
      <MaskGroup3 />
    </div>
  );
}

function Group8() {
  return (
    <div className="absolute contents left-[993px] top-0">
      <SecondaryNotification />
      <SecondarySettings />
      <Foto />
      <Foto1 />
    </div>
  );
}

function WebBrowser() {
  return (
    <div className="absolute h-[806px] left-[299px] overflow-clip top-[92px] w-[1141px]" data-name="web browser">
      <div className="absolute backdrop-blur-[238.554px] backdrop-filter bg-[#d1cbf7] bottom-0 left-0 right-0 shadow-[0px_0px_57.295px_0px_rgba(42,45,61,0.08)] top-[71px]" data-name="Background">
        <div className="absolute inset-0 pointer-events-none shadow-[0px_0px_93.755px_0px_inset_rgba(0,0,0,0.05)]" />
      </div>
      <Chat />
      <Group8 />
    </div>
  );
}

function CoupleMessages2() {
  return <div className="absolute bottom-[286.18px] h-[114.986px] left-[17.09px] right-[17.09px]" data-name="Couple Messages" />;
}

function Bubble2() {
  return (
    <div className="bg-white relative rounded-bl-[17.085px] rounded-br-[17.085px] rounded-tl-[2.136px] rounded-tr-[17.085px] shrink-0" data-name="bubble">
      <div className="box-border content-stretch flex flex-col gap-[17.085px] items-start overflow-clip p-[17.085px] relative rounded-[inherit]">
        <p className="font-['Source_Sans_Pro:Regular',_sans-serif] h-[21.187px] leading-[normal] not-italic relative shrink-0 text-[17.085px] text-black w-[185.971px]">How can I help you today?</p>
      </div>
      <div aria-hidden="true" className="absolute border-[#e3e7ea] border-[1.068px] border-solid inset-0 pointer-events-none rounded-bl-[17.085px] rounded-br-[17.085px] rounded-tl-[2.136px] rounded-tr-[17.085px]" />
    </div>
  );
}

function MsgBubble2() {
  return (
    <div className="content-stretch flex flex-col gap-[17.085px] items-start relative shrink-0" data-name="msg bubble">
      <Bubble2 />
    </div>
  );
}

function BotMessage2() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[4.271px] items-start left-[17px] top-[49.57px] w-[1107.05px]" data-name="bot message">
      <MsgBubble2 />
    </div>
  );
}

function QuickReply3() {
  return (
    <div className="bg-white box-border content-stretch flex flex-col gap-[10.678px] items-start p-[12.814px] relative rounded-[12.814px] shrink-0" data-name="_quick reply">
      <div aria-hidden="true" className="absolute border-[#6a2498] border-[1.068px] border-solid inset-0 pointer-events-none rounded-[12.814px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)]" />
      <div className="flex flex-col font-['Source_Sans_Pro:Bold',_sans-serif] justify-center leading-[0] not-italic relative shrink-0 text-[#6a2498] text-[14.95px] text-center text-nowrap">
        <p className="leading-[1.4] whitespace-pre">I am a doctor</p>
      </div>
    </div>
  );
}

function QuickReply4() {
  return (
    <div className="bg-white box-border content-stretch flex flex-col gap-[10.678px] items-start p-[12.814px] relative rounded-[12.814px] shrink-0" data-name="_quick reply">
      <div aria-hidden="true" className="absolute border-[#6a2498] border-[1.068px] border-solid inset-0 pointer-events-none rounded-[12.814px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)]" />
      <div className="flex flex-col font-['Source_Sans_Pro:Bold',_sans-serif] justify-center leading-[0] not-italic relative shrink-0 text-[#6a2498] text-[14.95px] text-center text-nowrap">
        <p className="leading-[1.4] whitespace-pre">I am a pharmacist</p>
      </div>
    </div>
  );
}

function QuickReply5() {
  return (
    <div className="bg-white box-border content-stretch flex flex-col gap-[10.678px] items-start p-[12.814px] relative rounded-[12.814px] shrink-0" data-name="_quick reply">
      <div aria-hidden="true" className="absolute border-[#6a2498] border-[1.068px] border-solid inset-0 pointer-events-none rounded-[12.814px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)]" />
      <div className="flex flex-col font-['Source_Sans_Pro:Bold',_sans-serif] justify-center leading-[0] not-italic relative shrink-0 text-[#6a2498] text-[14.95px] text-center text-nowrap">
        <p className="leading-[1.4] whitespace-pre">I am a nurse</p>
      </div>
    </div>
  );
}

function Row1() {
  return (
    <div className="content-stretch flex gap-[8.543px] items-start justify-end relative shrink-0" data-name="_row">
      <QuickReply3 />
      <QuickReply4 />
      <QuickReply5 />
    </div>
  );
}

function QuickReplies1() {
  return (
    <div className="box-border content-stretch flex flex-col gap-[8.543px] h-[59px] items-end justify-center pb-0 pt-[12.814px] px-0 relative shrink-0 w-[384px]" data-name="quick replies">
      <Row1 />
    </div>
  );
}

function BotMessage3() {
  return (
    <div className="content-stretch flex flex-col gap-[4.271px] items-start relative shrink-0 w-full" data-name="bot message">
      <QuickReplies1 />
    </div>
  );
}

function UserMessage1() {
  return <div className="h-[55.357px] shrink-0 w-full" data-name="user message" />;
}

function CoupleMessages3() {
  return (
    <div className="absolute bottom-[20.14px] content-stretch flex flex-col gap-[17.085px] h-[76px] items-start left-[17px] right-[17.23px]" data-name="Couple Messages">
      <BotMessage3 />
      <UserMessage1 />
    </div>
  );
}

function Bubble3() {
  return (
    <div className="bg-[#6a2498] box-border content-stretch flex flex-col gap-[17.085px] items-start overflow-clip p-[17.085px] relative rounded-[17.085px] shrink-0" data-name="bubble">
      <p className="font-['Source_Sans_Pro:Regular',_sans-serif] h-[21.187px] leading-[normal] not-italic relative shrink-0 text-[17.085px] text-white w-[37.665px]">Hello</p>
    </div>
  );
}

function MsgBubble3() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[17.085px] items-start left-[1052px] rounded-[17.085px] top-[104.57px]" data-name="msg bubble">
      <Bubble3 />
    </div>
  );
}

function Thread1() {
  return (
    <div className="absolute bg-[#f9f9fb] bottom-[76.86px] left-0 overflow-x-clip overflow-y-auto right-[-0.23px] top-[85.43px]" data-name="thread">
      <CoupleMessages2 />
      <BotMessage2 />
      <CoupleMessages3 />
      <MsgBubble3 />
    </div>
  );
}

function MsgInput1() {
  return (
    <div className="absolute bg-white bottom-0 content-stretch flex flex-col h-[89px] items-start justify-end left-0 right-0 rounded-bl-[17.085px] rounded-br-[17.085px]" data-name="msg input">
      <p className="font-['Source_Sans_Pro:Regular',_sans-serif] h-[33px] leading-[1.4] not-italic relative shrink-0 text-[#a0aaae] text-[0px] text-[20px] w-[255px]">
        <span className="text-white">|</span>Type your message...
      </p>
      <div className="bg-white h-[33px] shrink-0 w-[37px]" />
      <div className="absolute inset-0 pointer-events-none shadow-[0px_1.068px_0px_0px_inset_#a0aaae]" />
    </div>
  );
}

function Avatar1() {
  return (
    <div className="relative rounded-[106.784px] shrink-0 size-[42.714px]" data-name="avatar">
      <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[106.784px] size-full" src={imgAvatar} />
    </div>
  );
}

function Text1() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Text">
      <p className="font-['Source_Sans_Pro:Bold',_sans-serif] h-[21.187px] leading-[normal] not-italic relative shrink-0 text-[17.085px] text-black w-[121.234px]">ChatICU</p>
    </div>
  );
}

function BlogSectionsAvatarWithText1() {
  return (
    <div className="basis-0 content-stretch flex gap-[12.814px] grow items-center min-h-px min-w-px relative shrink-0" data-name="Blog Sections/Avatar with text">
      <Avatar1 />
      <Text1 />
    </div>
  );
}

function DotsVertical1() {
  return (
    <div className="absolute left-[4.27px] size-[34.171px] top-[4.27px]" data-name="Dots vertical">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 35 35">
        <g id="Dots vertical">
          <g id="Icon">
            <path d={svgPaths.p13e93f80} fill="var(--fill-0, #565E62)" />
            <path d={svgPaths.p35075a00} fill="var(--fill-0, #565E62)" />
            <path d={svgPaths.p3ba7800} fill="var(--fill-0, #565E62)" />
            <path d={svgPaths.p172ed7b0} stroke="var(--stroke-0, #565E62)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.13568" />
          </g>
        </g>
      </svg>
    </div>
  );
}

function MoreOptions1() {
  return (
    <div className="relative rounded-[21.357px] shrink-0 size-[42.714px]" data-name="More options">
      <DotsVertical1 />
    </div>
  );
}

function X1() {
  return (
    <div className="absolute left-[4.27px] size-[34.171px] top-[4.27px]" data-name="X">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 35 35">
        <g id="X">
          <path d={svgPaths.p24d9f280} id="Icon" stroke="var(--stroke-0, #565E62)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.13568" />
        </g>
      </svg>
    </div>
  );
}

function CloseChat1() {
  return (
    <div className="relative rounded-[21.357px] shrink-0 size-[42.714px]" data-name="Close Chat">
      <X1 />
    </div>
  );
}

function IconicActions1() {
  return (
    <div className="content-stretch flex gap-[12.814px] items-start relative shrink-0" data-name="Iconic Actions">
      <MoreOptions1 />
      <CloseChat1 />
    </div>
  );
}

function ChatHeader1() {
  return (
    <div className="absolute bg-[#f9f9fb] box-border content-stretch flex items-center left-0 p-[17.085px] right-[-0.23px] rounded-tl-[25.628px] rounded-tr-[25.628px] top-0" data-name="chat header">
      <BlogSectionsAvatarWithText1 />
      <IconicActions1 />
    </div>
  );
}

function Chat1() {
  return (
    <div className="absolute bg-[#f9f9fb] h-[771px] left-[calc(50%+149.5px)] overflow-clip rounded-[25.628px] shadow-[0px_10.678px_16.018px_-3.204px_rgba(0,0,0,0.1),0px_4.271px_6.407px_-2.136px_rgba(0,0,0,0.05),0px_0px_0px_1.068px_rgba(0,0,0,0.05)] top-[calc(50%+78.5px)] translate-x-[-50%] translate-y-[-50%] w-[1141px]" data-name="CHAT">
      <Thread1 />
      <MsgInput1 />
      <ChatHeader1 />
      <div className="absolute left-[17px] size-[44px] top-[16px]" data-name="image 7">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage7} />
      </div>
    </div>
  );
}

function MaskGroup4() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <div className="absolute bottom-0 left-[2.4%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.441px_0px] mask-size-[18.373px_11.024px] right-[-2.4%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFB7A0)" id="Rectangle 51" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-[4.8%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.882px_0px] mask-size-[18.373px_11.024px] right-[-4.8%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="url(#paint0_linear_5_3149)" id="Rectangle 52" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3149" x1="9.18639" x2="9.18639" y1="0" y2="6.39373">
              <stop stopColor="#FFAF8D" />
              <stop offset="1" stopColor="#FFB672" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute flex h-[calc(1px*((var(--transform-inner-width)*0.5)+(var(--transform-inner-height)*0.8660253882408142)))] items-center justify-center left-[99px] top-[126px] w-[calc(1px*((var(--transform-inner-height)*0.5)+(var(--transform-inner-width)*0.8660253882408142)))]" style={{ "--transform-inner-width": "48", "--transform-inner-height": "21.96875" } as React.CSSProperties}>
        <div className="flex-none rotate-[30deg]">
          <div className="h-[22px] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-99px_-126px] mask-size-[18.373px_11.024px] relative w-[48px]" style={{ maskImage: `url('${imgRectangle51}')` }}>
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 48 22">
              <path d={svgPaths.p8965e00} fill="url(#paint0_linear_5_3155)" id="Vector 74" />
              <defs>
                <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3155" x1="-41.8292" x2="42.2035" y1="8.05883" y2="12.9934">
                  <stop stopColor="white" />
                  <stop offset="1" stopColor="white" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Baju2() {
  return (
    <div className="absolute inset-[66.59%_14.99%_-3.33%_23.77%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-7.13px_-19.976px] mask-size-[30px_30px] overflow-clip" data-name="Baju" style={{ maskImage: `url('${imgBaju}')` }}>
      <div className="absolute inset-0">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFD4C7)" id="Rectangle 49" />
        </svg>
      </div>
      <MaskGroup4 />
      <div className="absolute inset-[60%_76.4%_-2%_21.2%]" data-name="Vector 72 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p340d2200} fill="url(#paint0_linear_5_3195)" fillRule="evenodd" id="Vector 72 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3195" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute inset-[60%_23.6%_-2%_74%]" data-name="Vector 73 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p1f806700} fill="url(#paint0_linear_5_3130)" fillRule="evenodd" id="Vector 73 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3130" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

function Leher2() {
  return (
    <div className="absolute bottom-0 left-[36.55%] right-[37.44%] top-[63.54%]" data-name="Leher">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 4 6">
        <g id="Leher">
          <path d={svgPaths.p1dc1b8c0} fill="var(--fill-0, #FBC6D7)" id="Leher_2" />
          <g id="Mask Group">
            <mask height="6" id="mask0_5_3120" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="4" x="0" y="0">
              <path d={svgPaths.p3802d100} fill="var(--fill-0, #FF7CA6)" id="Leher_3" />
            </mask>
            <g mask="url(#mask0_5_3120)">
              <path d={svgPaths.p1a240470} fill="var(--fill-0, #FF7CA6)" id="Leher_4" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

function Kepala4() {
  return (
    <div className="absolute bottom-[27.08%] left-0 right-0 top-0" data-name="Kepala">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14 12">
        <g id="Kepala">
          <g id="Kuping  kiri">
            <path d={svgPaths.p1c026200} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21" />
            <path d={svgPaths.p22e3080} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22" />
          </g>
          <g id="Kuping  kiri_2">
            <path d={svgPaths.p3804de40} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21_2" />
            <path d={svgPaths.p2d287ac0} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22_2" />
          </g>
          <path d={svgPaths.p2b5ee800} fill="var(--fill-0, #FBC6D7)" id="Kepala_2" />
          <g id="Mask Group">
            <mask height="12" id="mask0_5_3098" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="11" x="1" y="0">
              <path d={svgPaths.p38702500} fill="var(--fill-0, #FBC6D7)" id="Kepala_3" />
            </mask>
            <g mask="url(#mask0_5_3098)">
              <path d={svgPaths.p1b2b880} fill="var(--fill-0, #FF5E5E)" id="Ellipse 26" />
              <path d={svgPaths.p15b66900} fill="var(--fill-0, #FF5E5E)" id="Ellipse 27" />
            </g>
          </g>
          <path clipRule="evenodd" d={svgPaths.p2939d900} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 75 (Stroke)" />
          <g id="Group 103">
            <path d={svgPaths.p3e62a000} fill="var(--fill-0, #3B2144)" id="Ellipse 28" />
            <path d={svgPaths.p303da200} fill="var(--fill-0, #3B2144)" id="Ellipse 29" />
          </g>
          <path clipRule="evenodd" d={svgPaths.p28566a30} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 76 (Stroke)" />
        </g>
      </svg>
    </div>
  );
}

function Kepala5() {
  return (
    <div className="absolute inset-[20.42%_24.38%_28%_32.2%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-9.659px_-6.125px] mask-size-[30px_30px] overflow-clip" data-name="Kepala" style={{ maskImage: `url('${imgBaju}')` }}>
      <Leher2 />
      <Kepala4 />
    </div>
  );
}

function Group6() {
  return (
    <div className="absolute contents inset-[10%_14.99%_-3.33%_16.67%]">
      <Baju2 />
      <Kepala5 />
      <div className="absolute inset-[32.66%_35.69%_65.14%_58.19%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-17.456px_-9.798px] mask-size-[30px_30px]" data-name="Vector 77 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p2b2fe200} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 77 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[33.15%_51.61%_64.65%_42.26%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-12.679px_-9.945px] mask-size-[30px_30px]" data-name="Vector 78 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p1cbb4c00} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 78 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[10%_46.41%_24.38%_16.67%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-5px_-3px] mask-size-[30px_30px]" data-name="Subtract" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 20">
          <path d={svgPaths.p3588b800} fill="var(--fill-0, #3D0525)" id="Subtract" />
        </svg>
      </div>
      <div className="absolute inset-[14.63%_28.22%_50.36%_34.18%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-10.255px_-4.389px] mask-size-[30px_30px]" data-name="Union" style={{ maskImage: `url('${imgBaju}')` }}>
        <div className="absolute bottom-[0.01%] left-0 right-0 top-0">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 11">
            <path d={svgPaths.p38c5e700} fill="var(--fill-0, #4C062E)" id="Union" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function MaskGroup5() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <Group6 />
    </div>
  );
}

function Foto2() {
  return (
    <div className="absolute left-[1380px] size-[30px] top-[92px]" data-name="Foto 1">
      <div className="absolute bg-[#d9c8ff] left-0 rounded-[5px] size-[30px] top-0" />
      <MaskGroup5 />
    </div>
  );
}

function MaskGroup6() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <div className="absolute bottom-0 left-[2.4%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.441px_0px] mask-size-[18.373px_11.024px] right-[-2.4%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFB7A0)" id="Rectangle 51" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-[4.8%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-0.882px_0px] mask-size-[18.373px_11.024px] right-[-4.8%] top-0" style={{ maskImage: `url('${imgRectangle51}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="url(#paint0_linear_5_3149)" id="Rectangle 52" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3149" x1="9.18639" x2="9.18639" y1="0" y2="6.39373">
              <stop stopColor="#FFAF8D" />
              <stop offset="1" stopColor="#FFB672" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute flex h-[calc(1px*((var(--transform-inner-width)*0.5)+(var(--transform-inner-height)*0.8660253882408142)))] items-center justify-center left-[99px] top-[126px] w-[calc(1px*((var(--transform-inner-height)*0.5)+(var(--transform-inner-width)*0.8660253882408142)))]" style={{ "--transform-inner-width": "48", "--transform-inner-height": "21.96875" } as React.CSSProperties}>
        <div className="flex-none rotate-[30deg]">
          <div className="h-[22px] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-99px_-126px] mask-size-[18.373px_11.024px] relative w-[48px]" style={{ maskImage: `url('${imgRectangle51}')` }}>
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 48 22">
              <path d={svgPaths.p8965e00} fill="url(#paint0_linear_5_3155)" id="Vector 74" />
              <defs>
                <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3155" x1="-41.8292" x2="42.2035" y1="8.05883" y2="12.9934">
                  <stop stopColor="white" />
                  <stop offset="1" stopColor="white" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Baju3() {
  return (
    <div className="absolute inset-[66.59%_14.99%_-3.33%_23.77%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-7.13px_-19.976px] mask-size-[30px_30px] overflow-clip" data-name="Baju" style={{ maskImage: `url('${imgBaju}')` }}>
      <div className="absolute inset-0">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 12">
          <path d={svgPaths.p22e33300} fill="var(--fill-0, #FFD4C7)" id="Rectangle 49" />
        </svg>
      </div>
      <MaskGroup6 />
      <div className="absolute inset-[60%_76.4%_-2%_21.2%]" data-name="Vector 72 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p340d2200} fill="url(#paint0_linear_5_3195)" fillRule="evenodd" id="Vector 72 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3195" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute inset-[60%_23.6%_-2%_74%]" data-name="Vector 73 (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 5">
          <path clipRule="evenodd" d={svgPaths.p1f806700} fill="url(#paint0_linear_5_3130)" fillRule="evenodd" id="Vector 73 (Stroke)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_5_3130" x1="0.257219" x2="0.257219" y1="0.220473" y2="4.40947">
              <stop stopColor="#ECAA48" stopOpacity="0" />
              <stop offset="1" stopColor="#FF9D43" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

function Leher3() {
  return (
    <div className="absolute bottom-0 left-[36.55%] right-[37.44%] top-[63.54%]" data-name="Leher">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 4 6">
        <g id="Leher">
          <path d={svgPaths.p1dc1b8c0} fill="var(--fill-0, #FBC6D7)" id="Leher_2" />
          <g id="Mask Group">
            <mask height="6" id="mask0_5_3120" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="4" x="0" y="0">
              <path d={svgPaths.p3802d100} fill="var(--fill-0, #FF7CA6)" id="Leher_3" />
            </mask>
            <g mask="url(#mask0_5_3120)">
              <path d={svgPaths.p1a240470} fill="var(--fill-0, #FF7CA6)" id="Leher_4" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

function Kepala6() {
  return (
    <div className="absolute bottom-[27.08%] left-0 right-0 top-0" data-name="Kepala">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14 12">
        <g id="Kepala">
          <g id="Kuping  kiri">
            <path d={svgPaths.p1c026200} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21" />
            <path d={svgPaths.p22e3080} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22" />
          </g>
          <g id="Kuping  kiri_2">
            <path d={svgPaths.p3804de40} fill="var(--fill-0, #FBC6D7)" id="Ellipse 21_2" />
            <path d={svgPaths.p2d287ac0} fill="var(--fill-0, #FF7CA6)" id="Ellipse 22_2" />
          </g>
          <path d={svgPaths.p2b5ee800} fill="var(--fill-0, #FBC6D7)" id="Kepala_2" />
          <g id="Mask Group">
            <mask height="12" id="mask0_5_3098" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="11" x="1" y="0">
              <path d={svgPaths.p38702500} fill="var(--fill-0, #FBC6D7)" id="Kepala_3" />
            </mask>
            <g mask="url(#mask0_5_3098)">
              <path d={svgPaths.p1b2b880} fill="var(--fill-0, #FF5E5E)" id="Ellipse 26" />
              <path d={svgPaths.p15b66900} fill="var(--fill-0, #FF5E5E)" id="Ellipse 27" />
            </g>
          </g>
          <path clipRule="evenodd" d={svgPaths.p2939d900} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 75 (Stroke)" />
          <g id="Group 103">
            <path d={svgPaths.p3e62a000} fill="var(--fill-0, #3B2144)" id="Ellipse 28" />
            <path d={svgPaths.p303da200} fill="var(--fill-0, #3B2144)" id="Ellipse 29" />
          </g>
          <path clipRule="evenodd" d={svgPaths.p28566a30} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 76 (Stroke)" />
        </g>
      </svg>
    </div>
  );
}

function Kepala7() {
  return (
    <div className="absolute inset-[20.42%_24.38%_28%_32.2%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-9.659px_-6.125px] mask-size-[30px_30px] overflow-clip" data-name="Kepala" style={{ maskImage: `url('${imgBaju}')` }}>
      <Leher3 />
      <Kepala6 />
    </div>
  );
}

function Group7() {
  return (
    <div className="absolute contents inset-[10%_14.99%_-3.33%_16.67%]">
      <Baju3 />
      <Kepala7 />
      <div className="absolute inset-[32.66%_35.69%_65.14%_58.19%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-17.456px_-9.798px] mask-size-[30px_30px]" data-name="Vector 77 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p2b2fe200} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 77 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[33.15%_51.61%_64.65%_42.26%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-12.679px_-9.945px] mask-size-[30px_30px]" data-name="Vector 78 (Stroke)" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2 1">
          <path clipRule="evenodd" d={svgPaths.p1cbb4c00} fill="var(--fill-0, #FF7FA8)" fillRule="evenodd" id="Vector 78 (Stroke)" />
        </svg>
      </div>
      <div className="absolute inset-[10%_46.41%_24.38%_16.67%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-5px_-3px] mask-size-[30px_30px]" data-name="Subtract" style={{ maskImage: `url('${imgBaju}')` }}>
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 20">
          <path d={svgPaths.p3588b800} fill="var(--fill-0, #3D0525)" id="Subtract" />
        </svg>
      </div>
      <div className="absolute inset-[14.63%_28.22%_50.36%_34.18%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-10.255px_-4.389px] mask-size-[30px_30px]" data-name="Union" style={{ maskImage: `url('${imgBaju}')` }}>
        <div className="absolute bottom-[0.01%] left-0 right-0 top-0">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 11">
            <path d={svgPaths.p38c5e700} fill="var(--fill-0, #4C062E)" id="Union" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function MaskGroup7() {
  return (
    <div className="absolute contents left-0 top-0" data-name="Mask Group">
      <Group7 />
    </div>
  );
}

function Foto3() {
  return (
    <div className="absolute left-[1380px] size-[30px] top-[92px]" data-name="Foto 2">
      <div className="absolute bg-[#d9c8ff] left-0 rounded-[5px] size-[30px] top-0" />
      <MaskGroup7 />
    </div>
  );
}

function Group10() {
  return (
    <div className="absolute contents left-[1380px] top-[92px]">
      <Foto2 />
      <Foto3 />
    </div>
  );
}

function Group() {
  return (
    <div className="absolute inset-[94.56%_2.4%_2.39%_95.69%]" data-name="Group">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 28 28">
        <g id="Group">
          <path d={svgPaths.p18200b80} fill="var(--fill-0, #667085)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IconPeople() {
  return (
    <div className="absolute inset-[36.89%_95%_61.22%_3.75%]" data-name="Icon / People">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 17">
        <g id="Icon / People">
          <path d={svgPaths.p1ccaed00} fill="var(--fill-0, #4D4D4D)" id="icon/social/group_24px" />
        </g>
      </svg>
    </div>
  );
}

function Group1() {
  return (
    <div className="absolute inset-[12.5%_20.83%_8.33%_20.82%]" data-name="Group">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 10 14">
        <g id="Group">
          <path d={svgPaths.p18456840} fill="var(--fill-0, black)" fillOpacity="0.7" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Group2() {
  return (
    <div className="absolute contents inset-[12.5%_20.83%_8.33%_20.82%]" data-name="Group">
      <Group1 />
    </div>
  );
}

function IconBulb() {
  return (
    <div className="absolute inset-[29.89%_95.07%_68.22%_3.75%] overflow-clip" data-name="Icon / Bulb">
      <Group2 />
    </div>
  );
}

function Group12() {
  return (
    <div className="absolute inset-[43.89%_95.15%_54.35%_3.75%]">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 16 16">
        <g id="Group 394">
          <path clipRule="evenodd" d={svgPaths.p4111e80} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 25 (Stroke)" />
          <path clipRule="evenodd" d={svgPaths.p33b5fa80} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 27 (Stroke)" />
          <path clipRule="evenodd" d={svgPaths.p286f700} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 28 (Stroke)" />
          <path clipRule="evenodd" d={svgPaths.p2d226500} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 26 (Stroke)" />
          <path clipRule="evenodd" d={svgPaths.p4111e80} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 25 (Stroke)_2" />
          <path clipRule="evenodd" d={svgPaths.p33b5fa80} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 27 (Stroke)_2" />
          <path clipRule="evenodd" d={svgPaths.p286f700} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 28 (Stroke)_2" />
          <path clipRule="evenodd" d={svgPaths.p2d226500} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Rectangle 26 (Stroke)_2" />
        </g>
      </svg>
    </div>
  );
}

function Group11() {
  return (
    <div className="absolute inset-[50.78%_95.15%_47.65%_3.75%]">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 16 15">
        <g id="Group 395">
          <path clipRule="evenodd" d={svgPaths.pccc2c00} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Vector 63 (Stroke)" />
          <path clipRule="evenodd" d={svgPaths.p1e411480} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Vector 64 (Stroke)" />
          <path clipRule="evenodd" d={svgPaths.pccc2c00} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Vector 63 (Stroke)_2" />
        </g>
      </svg>
    </div>
  );
}

export default function IcuAi() {
  return (
    <div className="bg-[#f4f5f7] relative size-full" data-name="ICU AI_1">
      <div className="absolute bg-white h-[900px] left-[-1px] top-[-10px] w-[300px]" />
      <Frame />
      <div className="absolute left-[28px] size-[113px] top-[44px]" data-name="image 3">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage7} />
      </div>
      <div className="absolute h-[33px] left-[153px] top-[86px] w-[127px]" data-name="image 4">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage4} />
      </div>
      <Group9 />
      <Frame />
      <div className="absolute left-[28px] size-[113px] top-[44px]" data-name="image 5">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage7} />
      </div>
      <div className="absolute h-[33px] left-[153px] top-[86px] w-[127px]" data-name="image 6">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage4} />
      </div>
      <WebBrowser />
      <Frame />
      <div className="absolute left-[28px] size-[113px] top-[44px]" data-name="image 7">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage7} />
      </div>
      <div className="absolute h-[33px] left-[153px] top-[86px] w-[127px]" data-name="image 8">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage4} />
      </div>
      <Group9 />
      <Frame />
      <div className="absolute left-[28px] size-[113px] top-[44px]" data-name="image 9">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage7} />
      </div>
      <div className="absolute h-[33px] left-[153px] top-[86px] w-[127px]" data-name="image 10">
        <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none size-full" src={imgImage4} />
      </div>
      <div className="absolute backdrop-blur-[238.554px] backdrop-filter bg-[#d1cbf7] bottom-[2px] left-[299px] right-0 shadow-[0px_0px_57.295px_0px_rgba(42,45,61,0.08)] top-[163px]" data-name="Background">
        <div className="absolute inset-0 pointer-events-none shadow-[0px_0px_93.755px_0px_inset_rgba(0,0,0,0.05)]" />
      </div>
      <Chat1 />
      <Group10 />
      <div className="absolute flex h-[29px] items-center justify-center left-[1387px] top-[861px] w-[28px]">
        <div className="flex-none scale-y-[-100%]">
          <div className="bg-white h-[29px] w-[28px]" />
        </div>
      </div>
      <Group />
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[#c4c4c4] text-[15px] text-nowrap top-[451px] tracking-[1px] whitespace-pre">Record</p>
      <IconPeople />
      <IconBulb />
      <Group12 />
      <Group11 />
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[#1b1a1a] text-[15px] text-nowrap top-[267px] tracking-[1px] whitespace-pre">{`ICU AI   `}</p>
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[#c4c4c4] text-[15px] text-nowrap top-[392px] tracking-[1px] whitespace-pre">ICU Database</p>
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[#c4c4c4] text-[15px] text-nowrap top-[333px] tracking-[1px] whitespace-pre">ICU Patient AI</p>
      <IconPeople />
      <IconBulb />
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[#c4c4c4] text-[15px] text-nowrap top-[451px] tracking-[1px] whitespace-pre">Record</p>
      <IconPeople />
      <IconBulb />
      <Group12 />
      <Group11 />
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[15px] text-black text-nowrap top-[267px] tracking-[1px] whitespace-pre">{`ICU AI   `}</p>
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[#c4c4c4] text-[15px] text-nowrap top-[392px] tracking-[1px] whitespace-pre">ICU Database</p>
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[83px] not-italic text-[#c4c4c4] text-[15px] text-nowrap top-[333px] tracking-[1px] whitespace-pre">ICU Patient AI</p>
      <IconPeople />
      <IconBulb />
      <div className="absolute inset-[23%_94.94%_75.24%_3.96%]" data-name="Union (Stroke)">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 16 16">
          <path clipRule="evenodd" d={svgPaths.p118d9c00} fill="var(--fill-0, #121212)" fillRule="evenodd" id="Union (Stroke)" />
        </svg>
      </div>
      <p className="absolute font-['Poppins:SemiBold',_sans-serif] leading-[normal] left-[82px] not-italic text-[#c4c4c4] text-[15px] text-nowrap top-[203px] tracking-[1px] whitespace-pre">Overview</p>
    </div>
  );
}