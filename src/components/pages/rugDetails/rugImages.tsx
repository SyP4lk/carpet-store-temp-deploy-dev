"use client"

import { Locale } from "@/localization/config"
import { RugProduct } from "@/types/product"
import Image from "next/image"
import { FC } from "react"
import { shouldUnoptimizeImage, rewriteTicimaxImageUrl } from "@/lib/ticimaxImages";


type Props = {
    rug: RugProduct
    locale:Locale, 
    relatedProducts:RugProduct[]
}

const RugImages: FC<Props> = ({ rug, locale }) => {



    return (
        <div className="flex flex-col">
            {rug.images.map((image, index) => (
                <figure key={index} className="w-full">
                    <Image
                        key={index}
                        src={rewriteTicimaxImageUrl(image)}
                        alt={`${rug.product_name[locale]}`}
                        width={270}
                        height={387}
                        priority={index === 0}
                        className="w-full object-cover"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                        unoptimized={shouldUnoptimizeImage(image)}
                        loading={index === 0 ? "eager" : "lazy"}
                    />
                </figure>
            ))}
        </div>
    )
}

export default RugImages
