"use client"

import { useDictionary } from "@/hooks/useDictionary"
import { Locale } from "@/localization/config"
import { RugProduct } from "@/types/product"
import Image from "next/image"
import { useRouter } from "next/navigation"
import nProgress from "nprogress"
import { FC } from "react"

type Props = {
    rugs: RugProduct[]
    locale:Locale
}

const RugColors: FC<Props> = ({ rugs, locale}) => {
    const router = useRouter()
    const {dictionary} = useDictionary()

    return (
        <div className="flex flex-col">
            <h2 className="mb-2">{dictionary?.shared.colors}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-4">
                {rugs.map((rug, i) => (
                    <figure
                        key={i}
                        className="p-1 border cursor-pointer">
                        <Image
                            src={rug.images[0]}
                            alt={rug.product_name[locale]}
                            width={270}
                            height={380}
                            priority={i === 0}
                            loading={i === 0 ? "eager" : "lazy"}
                            className="w-full object-cover"
                            unoptimized={typeof rug.images?.[0] === "string" && rug.images[0].includes("ticimax.cloud")}
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                            onClick={() => {
                                nProgress.start()
                                router.push(`/${locale}/rugs/${rug.id}`);
                            }}
                        />
                    </figure>
                ))}
            </div>
        </div>
    )
}

export default RugColors
